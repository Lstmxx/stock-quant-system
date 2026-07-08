export interface LlmModel {
  id: string;
  provider: string;
  modelName: string;
  name: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  isDefault: boolean | null;
}
