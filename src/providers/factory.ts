import { OpenAICompatibleProvider } from './openai-compatible.js';
import { AnthropicProvider } from './anthropic.js';
import type { Provider, ProviderConfig } from './base.js';

/**
 * Pick the right Provider implementation based on the saved config.
 *
 * Heuristic (no extra DB column needed): anything pointing at Anthropic's API
 * gets the dedicated adapter (different request/response shape, SSE event
 * types, separate system field). Everything else gets the generic
 * OpenAI-compatible implementation, which covers the long tail of providers
 * (Zhipu, DeepSeek, Moonshot, OpenAI, Groq, Mistral, etc.).
 *
 * To support more non-OpenAI protocols later (Google Gemini, Cohere, etc.),
 * add another branch here.
 */
export function createProvider(config: ProviderConfig): Provider {
  const host = config.baseUrl.toLowerCase();
  if (
    host.includes('anthropic.com') ||
    config.apiPath === '/v1/messages' // explicit override for Anthropic proxies
  ) {
    return new AnthropicProvider(config);
  }
  return new OpenAICompatibleProvider(config);
}
