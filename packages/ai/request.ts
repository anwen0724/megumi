// Defines provider-neutral AI requests passed to provider adapters.
import { type JsonObject } from '@megumi/shared/primitives/json';
import { type ModelContextInput } from './context';
import { type Model } from './model';
import { type ProviderRegistry } from './registry';
import { type ToolSet } from './tool-set';

export type ProviderCredential =
  | { type: 'api_key'; value: string }
  | { type: 'bearer_token'; value: string }
  | { type: 'custom_headers'; headers: Record<string, string> };

export interface CredentialResolver {
  resolveCredential(providerId: string): Promise<ProviderCredential | undefined>;
}

export interface AiRequestOptions {
  registry?: ProviderRegistry;
  signal?: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
  transport?: 'sse' | 'websocket' | 'auto';
  cacheRetention?: 'none' | 'short' | 'long';
  maxRetries?: number;
  maxRetryDelayMs?: number;
  credential?: ProviderCredential;
  credentialResolver?: CredentialResolver;
  metadata?: JsonObject;
}

export interface ProviderAdapterRequest {
  model: Model;
  context: ModelContextInput;
  toolSet?: ToolSet;
  options: AiRequestOptions;
}
