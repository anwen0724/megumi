import { describe, expect, it } from 'vitest';
import {
  RuntimeErrorSchema,
  isRuntimeErrorCode,
  type RuntimeError,
} from '@megumi/shared/runtime-errors';
import {
  RuntimeIpcErrorSchema,
  type RuntimeIpcError,
} from '@megumi/shared/ipc-errors';

describe('runtime error contracts', () => {
  it('accepts display-safe runtime errors', () => {
    const error: RuntimeError = {
      code: 'provider_auth_failed',
      message: 'Provider rejected the API key.',
      severity: 'error',
      retryable: false,
      source: 'provider',
      details: {
        providerId: 'deepseek',
        status: 401,
      },
      debugId: 'debug-1',
    };

    expect(RuntimeErrorSchema.parse(error)).toEqual(error);
  });

  it('rejects unknown runtime error codes', () => {
    expect(() =>
      RuntimeErrorSchema.parse({
        code: 'not_real',
        message: 'Nope.',
        severity: 'error',
        retryable: false,
        source: 'main',
      }),
    ).toThrow();
  });

  it('supports tool, approval, workspace, memory, and artifact sources', () => {
    for (const source of ['tool', 'approval', 'workspace', 'memory', 'artifact'] as const) {
      expect(
        RuntimeErrorSchema.parse({
          code: 'runtime_unknown',
          message: 'Runtime subsystem failed.',
          severity: 'error',
          retryable: false,
          source,
        }).source,
      ).toBe(source);
    }
  });

  it('keeps RuntimeIpcError compatible with RuntimeError', () => {
    const error: RuntimeIpcError = {
      code: 'ipc_invoke_failed',
      message: 'Megumi could not reach the main process.',
      severity: 'error',
      retryable: true,
      source: 'preload',
    };

    expect(RuntimeIpcErrorSchema.parse(error)).toEqual(error);
  });

  it('checks runtime error codes', () => {
    expect(isRuntimeErrorCode('provider_missing_api_key')).toBe(true);
    expect(isRuntimeErrorCode('definitely_not_a_code')).toBe(false);
  });
});
