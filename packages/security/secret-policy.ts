import {
  isProviderId,
  type ProviderId,
  type SecretRef,
  type SecretScope,
} from '@megumi/shared/provider';

const PROVIDER_API_KEY_SCOPE: SecretScope = 'provider-api-key';

export function buildProviderApiKeySecretRef(providerId: ProviderId): SecretRef {
  return {
    id: `secret:${PROVIDER_API_KEY_SCOPE}:${providerId}`,
    providerId,
    scope: PROVIDER_API_KEY_SCOPE,
  };
}

export function isSecretRef(value: unknown): value is SecretRef {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.providerId === 'string' &&
    isProviderId(candidate.providerId) &&
    candidate.scope === PROVIDER_API_KEY_SCOPE &&
    candidate.id === `secret:${PROVIDER_API_KEY_SCOPE}:${candidate.providerId}`
  );
}

export function isProviderApiKeySecretRef(value: unknown, providerId: ProviderId): value is SecretRef {
  return isSecretRef(value) && value.providerId === providerId && value.scope === PROVIDER_API_KEY_SCOPE;
}

