// Renderer-facing provider DTOs. Plaintext credentials must never be exposed here.
export type ProviderId = 'deepseek' | 'openai' | 'anthropic' | (string & {});
export type ProviderCredentialSource = 'settings' | 'environment' | 'missing';

export interface ProviderPublicStatus {
  providerId: ProviderId;
  displayName: string;
  enabled: boolean;
  baseUrl?: string;
  defaultModelId: string;
  hasApiKey: boolean;
  credentialSource: ProviderCredentialSource;
  envOverrideActive: boolean;
  apiKeyEnv?: string;
  apiKeyEnvCustomized?: boolean;
}
