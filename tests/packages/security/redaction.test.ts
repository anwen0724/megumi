// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  redactObjectSecrets,
  redactRuntimeDetails,
  redactRuntimeMessage,
  redactRuntimeValue,
  redactSecret,
} from '@megumi/security/redaction';

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

  it('redacts runtime secret-like values from display-safe messages', () => {
    expect(redactRuntimeMessage('Authorization: Bearer abcdef1234567890')).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(redactRuntimeMessage('apiKey=sk-test-1234567890abcdef')).toBe('apiKey=[redacted]');
    expect(redactRuntimeMessage('token: secret-token-value')).toBe('token: [redacted]');
  });

  it('redacts runtime values recursively while preserving safe diagnostics', () => {
    expect(
      redactRuntimeValue({
        providerId: 'deepseek',
        statusCode: 401,
        requestId: 'ipc-provider-list-1',
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        headers: {
          authorization: 'Bearer abcdef1234567890',
        },
        nested: {
          apiKey: 'sk-test-secret',
          values: ['visible', 'Bearer abcdef1234567890'],
        },
      }),
    ).toEqual({
      providerId: 'deepseek',
      statusCode: 401,
      requestId: 'ipc-provider-list-1',
      traceId: 'trace-provider-1',
      debugId: 'debug-provider-1',
      headers: {
        authorization: '[redacted]',
      },
      nested: {
        apiKey: '[redacted]',
        values: ['visible', 'Bearer [redacted]'],
      },
    });
  });

  it('redacts runtime details and removes stack and cause fields', () => {
    expect(
      redactRuntimeDetails({
        debugId: 'debug-provider-1',
        operationName: 'provider.list',
        stack: 'Error: raw stack with sk-test-secret',
        cause: {
          message: 'raw cause',
        },
        rawProviderBody: '{"apiKey":"sk-test-secret"}',
        message: 'Failed with Bearer abcdef1234567890',
      }),
    ).toEqual({
      debugId: 'debug-provider-1',
      operationName: 'provider.list',
      rawProviderBody: '[redacted]',
      message: 'Failed with Bearer [redacted]',
    });
  });
});
