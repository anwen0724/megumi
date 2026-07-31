/*
 * Verifies safe runtime error normalization and sensitive-detail filtering.
 */
import { describe, expect, it } from 'vitest';
import {
  createRuntimeErrorFromUnknown,
  normalizeRuntimeError,
} from '../../../packages/events/src/index';
import { RuntimeException } from '../../../packages/events/src/runtime-error';

describe('runtime error normalization', () => {
  it('does not expose raw exception messages or stacks and keeps debug identity', () => {
    const error = normalizeRuntimeError(new Error('api_key=super-secret'), {
      source: 'provider', debugId: 'debug-123', fallbackMessage: 'Provider request failed.',
    });
    expect(error).toEqual({
      code: 'runtime_unknown', message: 'Provider request failed.', severity: 'error', retryable: true,
      source: 'provider', debugId: 'debug-123',
    });
    expect(JSON.stringify(error)).not.toContain('super-secret');
    expect(JSON.stringify(error)).not.toContain('stack');
  });

  it('preserves an explicitly constructed RuntimeException contract', () => {
    const runtimeError = {
      code: 'tool_execution_failed' as const, message: 'Tool execution failed.', severity: 'error' as const,
      retryable: false, source: 'tool' as const, debugId: 'debug-456',
    };
    expect(normalizeRuntimeError(new RuntimeException(runtimeError), {
      source: 'core', debugId: 'debug-unused',
    })).toEqual(runtimeError);
  });

  it('uses a safe fallback for the legacy unknown-normalization helper', () => {
    const error = createRuntimeErrorFromUnknown(new Error('raw prompt contents'), 'Agent run failed.');
    expect(error.message).toBe('Agent run failed.');
    expect(error.debugId).toMatch(/^debug-/);
    expect(JSON.stringify(error)).not.toContain('raw prompt');
  });

  it('filters sensitive detail fields from stable RuntimeError-shaped values', () => {
    const error = normalizeRuntimeError({
      code: 'provider_auth_failed',
      message: 'Provider authentication failed.',
      severity: 'error',
      retryable: false,
      source: 'provider',
      details: {
        statusCode: 401,
        providerBody: 'raw response',
        prompt: 'private prompt',
        nested: { apiKey: 'super-secret', attempt: 2 },
      },
    }, { source: 'provider', debugId: 'debug-789' });

    expect(error.details).toEqual({ statusCode: 401, nested: { attempt: 2 } });
    expect(JSON.stringify(error)).not.toContain('raw response');
    expect(JSON.stringify(error)).not.toContain('private prompt');
    expect(JSON.stringify(error)).not.toContain('super-secret');
  });
});
