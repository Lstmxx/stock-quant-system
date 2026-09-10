import type { api } from '../../api/api';
import type { ApiData } from '../../api/request';

export const LLM_PROVIDERS = [
  'openai',
  'anthropic',
  'ollama',
  'openai_compatible',
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export type ApiKeyAction = 'keep' | 'replace' | 'clear';

export type LlmModel = ApiData<typeof api.llm.get>[number];

export interface LlmModelFormValues {
  name: string;
  provider: LlmProvider;
  modelName: string;
  baseUrl?: string | null;
  apiKey?: string;
  apiKeyAction?: ApiKeyAction;
  isDefault?: boolean;
}

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  openai_compatible: 'OpenAI-compatible',
};

export function providerRequiresApiKey(provider: LlmProvider): boolean {
  return provider !== 'ollama';
}

export function providerSupportsCustomBaseUrl(provider: LlmProvider): boolean {
  return provider === 'ollama' || provider === 'openai_compatible';
}
