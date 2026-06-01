import { describe, expect, it } from 'vitest';

import {
  classifyAutomaticModelStepRetry,
  createAutomaticRetryBackoffMs,
} from '@megumi/desktop/main/services/session-retry-policy.service';
import type { RuntimeError } from '@megumi/shared/runtime-errors';

function error(overrides: Partial<RuntimeError>): RuntimeError {
  return {
    code: overrides.code ?? 'provider_network_error',
    message: overrides.message ?? 'Provider returned a network error.',
    severity: overrides.severity ?? 'error',
    retryable: overrides.retryable ?? true,
    source: overrides.source ?? 'provider',
  };
}

describe('session retry policy', () => {
  it.each([
    ['provider_overload', error({ code: 'provider_network_error', message: 'overloaded_error' })],
    ['rate_limited', error({ code: 'provider_rate_limited', message: '429 rate limit' })],
    ['service_unavailable', error({ code: 'provider_network_error', message: '503 service unavailable' })],
    ['network_timeout', error({ code: 'provider_network_error', message: 'request timed out' })],
    ['premature_stream_end', error({ code: 'provider_network_error', message: 'stream ended before message_stop' })],
    ['runtime_provider_error', error({ code: 'runtime_unknown', message: 'provider returned error' })],
  ] as const)('classifies retryable transient provider errors as %s', (reason, runtimeError) => {
    expect(classifyAutomaticModelStepRetry(runtimeError)).toMatchObject({
      retryable: true,
      reason,
    });
  });

  it.each([
    error({ code: 'runtime_unknown', message: 'context window exceeded', source: 'core', retryable: false }),
    error({ code: 'provider_invalid_request', message: 'insufficient_quota billing', retryable: false }),
    error({ code: 'security_denied', message: 'permission denied', source: 'security', retryable: false }),
    error({ code: 'runtime_cancelled', message: 'user cancelled', source: 'core', retryable: false }),
    error({ code: 'tool_input_invalid', message: 'tool input validation failed', source: 'tool', retryable: false }),
    error({ code: 'runtime_protocol_violation', message: 'deterministic runtime protocol violation', source: 'core', retryable: false }),
  ])('rejects non retryable failures', (runtimeError) => {
    expect(classifyAutomaticModelStepRetry(runtimeError)).toMatchObject({
      retryable: false,
    });
  });

  it.each([
    error({ code: 'provider_auth_failed', message: '401 invalid api key', source: 'provider', retryable: false }),
    error({ code: 'provider_invalid_request', message: '400 invalid request', source: 'provider', retryable: false }),
    error({ code: 'provider_unsupported', message: 'provider unsupported', source: 'provider', retryable: false }),
  ])('rejects non transient provider failures', (runtimeError) => {
    expect(classifyAutomaticModelStepRetry(runtimeError)).toMatchObject({
      retryable: false,
    });
  });

  it.each([
    error({ code: 'runtime_unknown', message: '429 rate limit', source: 'core', retryable: true }),
    error({ code: 'tool_execution_failed', message: 'service unavailable', source: 'tool', retryable: true }),
    error({ code: 'security_denied', message: 'network timeout', source: 'security', retryable: true }),
  ])('rejects retryable non provider failures with transient-looking messages', (runtimeError) => {
    expect(classifyAutomaticModelStepRetry(runtimeError)).toMatchObject({
      retryable: false,
    });
  });

  it('rejects non retryable generic provider errors', () => {
    expect(classifyAutomaticModelStepRetry(error({
      code: 'runtime_unknown',
      message: 'provider returned error',
      source: 'provider',
      retryable: false,
    }))).toMatchObject({
      retryable: false,
    });
  });

  it('uses bounded exponential backoff', () => {
    expect(createAutomaticRetryBackoffMs({ attemptNumber: 1, baseDelayMs: 2000, maxDelayMs: 8000 })).toBe(2000);
    expect(createAutomaticRetryBackoffMs({ attemptNumber: 2, baseDelayMs: 2000, maxDelayMs: 8000 })).toBe(4000);
    expect(createAutomaticRetryBackoffMs({ attemptNumber: 4, baseDelayMs: 2000, maxDelayMs: 8000 })).toBe(8000);
  });
});
