import type {
  ChatRequest,
  ChatResponse,
  ModelInfo,
  Provider,
  ProviderConfig,
} from './base.js';

/**
 * Anthropic Claude provider.
 *
 * Anthropic's Messages API is NOT OpenAI-compatible (different request shape,
 * different SSE event types, separate system field). This class translates
 * OpenAI-format ChatRequest → Anthropic /v1/messages format, and
 * Anthropic response → OpenAI-format ChatResponse, so the hub's chat route
 * can serve it through the same /v1/chat/completions endpoint.
 *
 * No public /v1/models endpoint — we hardcode a known-models list and the user
 * is expected to use the right `anthropic:claude-...` model id.
 */

const ANTHROPIC_VERSION = '2023-06-01';

// Curated known model list (Anthropic doesn't expose a public model list API).
// Keep this in sync with what's actually offered on api.anthropic.com.
const KNOWN_MODELS: ModelInfo[] = [
  { id: 'claude-3-7-sonnet-20250219', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-3-5-sonnet-20240620', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-3-5-haiku-20241022', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-3-opus-20240229', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-3-sonnet-20240229', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-3-haiku-20240307', object: 'model', owned_by: 'anthropic' },
];

// Translate OpenAI messages → { system, messages } for Anthropic.
// Anthropic wants the system prompt in a separate `system` field, and only
// 'user' / 'assistant' roles in the messages array. 'tool' role is unsupported
// in this minimal adapter. ChatMessage.content is typed as string in our
// internal schema; multi-modal (array) content is dropped here.
function extractSystem(messages: ChatRequest['messages']): {
  system: string | undefined;
  messages: { role: 'user' | 'assistant'; content: string }[];
} {
  const systemParts: string[] = [];
  const chat: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    const text = m.content || '';
    if (m.role === 'system') {
      if (text) systemParts.push(text);
    } else if (m.role === 'user' || m.role === 'assistant') {
      chat.push({ role: m.role, content: text });
    }
    // 'tool' role: silently drop (no Anthropic analog in basic adapter)
  }
  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: chat,
  };
}

function translateStopReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

export class AnthropicProvider implements Provider {
  public readonly id: string;
  public readonly label: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(cfg: ProviderConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
    // Allow baseUrl override (e.g. for proxies), but default to Anthropic's.
    // If apiPath is provided, append it; otherwise hit /v1/messages on the host.
    const base = cfg.baseUrl.replace(/\/+$/, '');
    this.baseUrl = cfg.apiPath && cfg.apiPath.startsWith('/')
      ? base + cfg.apiPath
      : base + '/v1/messages';
    this.apiKey = cfg.apiKey;
  }

  async listModels(): Promise<ModelInfo[]> {
    return KNOWN_MODELS;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = extractSystem(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.max_tokens ?? 1024,
      messages,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stop) {
      body.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
    }

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data: any = await res.json();
    const text = (data.content || [])
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('');

    return {
      id: data.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model || req.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: translateStopReason(data.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens:
          (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
    };
  }

  async chatStream(
    req: ChatRequest,
    onChunk: (raw: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const { system, messages } = extractSystem(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.max_tokens ?? 1024,
      messages,
      stream: true,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 500)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const messageId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = req.model;
    let sawStop = false;

    // Helper: emit a single OpenAI-format chunk
    const emit = (delta: Record<string, unknown>, finish: string | null) => {
      const chunk = {
        id: messageId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          { index: 0, delta, finish_reason: finish },
        ],
      };
      onChunk(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const eventBlock = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        let eventType = '';
        let dataLine = '';
        for (const line of eventBlock.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLine += line.slice(5).trim();
          }
        }
        if (!dataLine) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (eventType === 'content_block_delta') {
          if (parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
            emit({ content: parsed.delta.text }, null);
          }
          // Other delta types (input_json_delta, etc.) — ignore in this minimal adapter
        } else if (eventType === 'message_start') {
          // Optional: emit a role-only first chunk so clients can render immediately
          if (parsed.message?.model) {
            // We trust req.model since Anthropic's model may include version info
          }
        } else if (eventType === 'message_delta') {
          // final stop_reason + usage
          const stopReason = parsed.delta?.stop_reason;
          if (stopReason) {
            emit({}, translateStopReason(stopReason));
            sawStop = true;
          }
        } else if (eventType === 'message_stop') {
          if (!sawStop) emit({}, 'stop');
          sawStop = true;
        } else if (eventType === 'error' || eventType === 'ping') {
          // 'error' is a real Anthropic error event; surface it
          if (eventType === 'error') {
            onChunk(
              `data: ${JSON.stringify({
                error: { message: parsed.error?.message ?? 'upstream error', type: 'upstream_error' },
              })}\n\n`,
            );
          }
        }
      }
    }
    if (!sawStop) {
      // Stream ended without an explicit stop event
      onChunk('data: [DONE]\n\n');
    } else {
      onChunk('data: [DONE]\n\n');
    }
  }
}
