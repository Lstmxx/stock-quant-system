export const LLM_PROVIDERS = [
  'openai',
  'anthropic',
  'ollama',
  'openai_compatible',
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export type ApiKeyAction = 'keep' | 'replace' | 'clear';

export interface LlmModel {
  id: string;
  provider: LlmProvider;
  modelName: string;
  name: string;
  baseUrl: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

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
