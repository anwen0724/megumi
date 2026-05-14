import type { ProviderId, SecretRef } from '@megumi/shared/provider-contracts';

export type SecretKind = 'provider-api-key';

export interface ProviderSecretDescriptor {
  providerId: ProviderId;
  kind: SecretKind;
  ref: SecretRef;
  hasSecret: boolean;
}

export interface RedactionOptions {
  visiblePrefix?: number;
  visibleSuffix?: number;
}
