// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { redactObjectSecrets, redactSecret } from '@megumi/security/redaction';

describe('redaction', () => {
  it('redacts full secret values by default', () => {
    expect(redactSecret('sk-live-secret-value')).toBe('[redacted]');
    expect(redactSecret('')).toBe('[redacted]');
  });

  it('keeps requested prefix and suffix without exposing the whole secret', () => {
    expect(redactSecret('sk-1234567890', { visiblePrefix: 3, visibleSuffix: 2 })).toBe('sk-...[redacted]...90');
  });

  it('redacts secret-like object keys recursively', () => {
    const input = {
      providerId: 'deepseek',
      apiKey: 'sk-deepseek',
      nested: {
        token: 'secret-token',
        normal: 'visible',
      },
    };

    expect(redactObjectSecrets(input)).toEqual({
      providerId: 'deepseek',
      apiKey: '[redacted]',
      nested: {
        token: '[redacted]',
        normal: 'visible',
      },
    });
  });
});
