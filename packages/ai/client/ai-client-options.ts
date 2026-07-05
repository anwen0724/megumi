import { type JsonObject } from '../core/json';
import { type ProtocolRegistry } from '../protocols/protocol-registry';

export type ProviderCredential =
    | { type: 'api_key'; value: string }
    | { type: 'bearer_token'; value: string }
    | { type: 'custom_headers'; headers: Record<string, string> };

export interface CredentialResolver {
    resolveCredential(providerId: string): Promise<ProviderCredential | undefined>;
}

export interface AiClientOptions {
    registry: ProtocolRegistry;
    credentialResolver?: CredentialResolver;
    defaultMetadata?: JsonObject;
    defaultMaxRetries?: number;
    defaultMaxRetryDelayMs?: number;
}
