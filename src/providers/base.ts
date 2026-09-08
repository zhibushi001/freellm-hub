/**
 * Provider abstraction. All providers implement this interface; the chat route talks
 * only to this interface, not to any specific provider SDK.
 *
 * Built for OpenAI-compatible APIs (Zhipu, DeepSeek, Moonshot, OpenAI, etc. all use it).
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
}

export interface ModelInfo {
  id: string;
  object: 'model';
  created?: number;
  owned_by: string;
}

export interface ProviderConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiPath: string;       // typically '/chat/completions'
  modelsPath: string;    // typically '/models'
  apiKey: string;        // decrypted
}

export interface Provider {
  readonly id: string;
  readonly label: string;
  /** List models this provider offers (calls /models endpoint) */
  listModels(): Promise<ModelInfo[]>;
  /** Send a chat request (non-streaming) and return the full response */
  chat(req: ChatRequest): Promise<ChatResponse>;
  /**
   * Send a streaming chat request. The provider parses SSE chunks and invokes `onChunk`
   * with the raw `data: {...}\n\n` (or `data: [DONE]\n\n`) text. Caller forwards to client.
   * Resolves when the stream is complete.
   */
  chatStream(req: ChatRequest, onChunk: (raw: string) => void, signal?: AbortSignal): Promise<void>;
}
