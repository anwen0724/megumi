import { type JsonObject } from '@megumi/shared/primitives/json';
import { type ProviderRegistry } from '../providers/provider-registry';

export type ProviderCredential =
    | { type: 'api_key'; value: string }
    | { type: 'bearer_token'; value: string }
    | { type: 'custom_headers'; headers: Record<string, string> };

export interface CredentialResolver {
    resolveCredential(providerId: string): Promise<ProviderCredential | undefined>;
}

export interface AiClientOptions {
    registry: ProviderRegistry;
    credentialResolver?: CredentialResolver;
    defaultMetadata?: JsonObject;
    defaultMaxRetries?: number;
    defaultMaxRetryDelayMs?: number;
}