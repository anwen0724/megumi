// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildProviderApiKeySecretRef,
  isProviderApiKeySecretRef,
  isSecretRef,
} from '@megumi/security/secret-policy';

describe('secret policy', () => {
  it('builds stable provider api key secret refs', () => {
    expect(buildProviderApiKeySecretRef('deepseek')).toEqual({
      id: 'secret:provider-api-key:deepseek',
      providerId: 'deepseek',
      scope: 'provider-api-key',
    });
  });

  it('validates secret refs', () => {
    expect(isSecretRef({
      id: 'secret:provider-api-key:openai',
      providerId: 'openai',
      scope: 'provider-api-key',
    })).toBe(true);

    expect(isSecretRef({
      id: 'secret:provider-api-key:ollama',
      providerId: 'ollama',
      scope: 'provider-api-key',
    })).toBe(false);

    expect(isSecretRef(null)).toBe(false);
  });

  it('checks provider api key secret refs', () => {
    const ref = buildProviderApiKeySecretRef('anthropic');

    expect(isProviderApiKeySecretRef(ref, 'anthropic')).toBe(true);
    expect(isProviderApiKeySecretRef(ref, 'openai')).toBe(false);
  });
});
