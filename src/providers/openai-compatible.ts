/**
 * Generic OpenAI-compatible provider. Works for Zhipu, DeepSeek, Moonshot, OpenAI,
 * Groq, Mistral, and most others that follow the OpenAI Chat Completions spec.
 */

import type {
  ChatRequest,
  ChatResponse,
  ModelInfo,
  Provider,
  ProviderConfig,
} from './base.js';

export class OpenAICompatibleProvider implements Provider {
  readonly id: string;
  readonly label: string;
  private readonly baseUrl: string; // e.g. https://api.openai.com/v1
  private readonly apiPath: string;
  private readonly modelsPath: string;
  private readonly apiKey: string;

  constructor(cfg: ProviderConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
    // Normalize: strip trailing slash
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.apiPath = cfg.apiPath.startsWith('/') ? cfg.apiPath : '/' + cfg.apiPath;
    this.modelsPath = cfg.modelsPath.startsWith('/') ? cfg.modelsPath : '/' + cfg.modelsPath;
    this.apiKey = cfg.apiKey;
  }

  private get chatUrl(): string {
    return this.baseUrl + this.apiPath;
  }

  private get modelsUrl(): string {
    return this.baseUrl + this.modelsPath;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(this.modelsUrl, { headers: this.headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${this.label} /models failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: ModelInfo[] };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      object: 'model',
      created: m.created,
      owned_by: m.owned_by ?? this.label,
    }));
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(this.chatUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${this.label} chat failed: HTTP ${res.status} — ${body.slice(0, 500)}`);
    }
    return (await res.json()) as ChatResponse;
  }
}
