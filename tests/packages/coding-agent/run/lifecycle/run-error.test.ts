// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  RuntimeException,
  normalizeRuntimeError,
} from '@megumi/coding-agent/state';
import {
  assertRuntime,
  throwRuntimeError,
} from '@megumi/coding-agent/state';

describe('runtime exception foundation', () => {
  const runtimeError = {
    code: 'runtime_protocol_violation',
    message: 'Runtime invariant failed.',
    severity: 'error',
    retryable: false,
    source: 'core',
    debugId: 'debug-core-1',
    details: {
      operationName: 'session.message.send',
      reason: 'missing runtime context',
    },
  } as const;

  it('wraps a display-safe RuntimeError without exposing stack or cause in the runtime error shape', () => {
    const cause = new Error('raw internal cause with sk-test-secret');
    const exception = new RuntimeException(runtimeError, { cause });

    expect(exception).toBeInstanceOf(Error);
    expect(exception.name).toBe('RuntimeException');
    expect(exception.message).toBe('Runtime invariant failed.');
    expect(exception.cause).toBe(cause);
    expect(exception.runtimeError).toEqual(runtimeError);
    expect(exception.toRuntimeError()).toEqual(runtimeError);
    expect(JSON.stringify(exception.toRuntimeError())).not.toContain('stack');
    expect(JSON.stringify(exception.toRuntimeError())).not.toContain('raw internal cause');
    expect(JSON.stringify(exception.toRuntimeError())).not.toContain('sk-test-secret');
  });

  it('throws RuntimeException through throwRuntimeError', () => {
    expect(() => throwRuntimeError(runtimeError)).toThrow(RuntimeException);

    try {
      throwRuntimeError(runtimeError);
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeException);
      expect((error as RuntimeException).toRuntimeError()).toEqual(runtimeError);
    }
  });

  it('asserts runtime conditions with a RuntimeError', () => {
    expect(() => assertRuntime(true, runtimeError)).not.toThrow();
    expect(() => assertRuntime(false, runtimeError)).toThrow(RuntimeException);
  });

  it('normalizes RuntimeException by preserving its RuntimeError', () => {
    const exception = new RuntimeException(runtimeError, {
      cause: new Error('raw internal cause'),
    });

    expect(
      normalizeRuntimeError(exception, {
        source: 'main',
        debugId: 'debug-main-unused',
      }),
    ).toEqual(runtimeError);
  });

  it('normalizes unknown errors into display-safe runtime_unknown errors', () => {
    const normalized = normalizeRuntimeError(new Error('provider leaked sk-test-secret'), {
      source: 'main',
      debugId: 'debug-main-1',
    });

    expect(normalized).toEqual({
      code: 'runtime_unknown',
      message: 'Unexpected runtime error.',
      severity: 'error',
      retryable: true,
      source: 'main',
      debugId: 'debug-main-1',
    });
    expect(JSON.stringify(normalized)).not.toContain('provider leaked');
    expect(JSON.stringify(normalized)).not.toContain('sk-test-secret');
    expect(JSON.stringify(normalized)).not.toContain('stack');
  });

  it('allows a boundary-specific fallback message for unknown errors', () => {
    expect(
      normalizeRuntimeError('not an Error instance', {
        source: 'preload',
        debugId: 'debug-preload-1',
        fallbackMessage: 'Megumi could not reach the main process.',
      }),
    ).toEqual({
      code: 'runtime_unknown',
      message: 'Megumi could not reach the main process.',
      severity: 'error',
      retryable: true,
      source: 'preload',
      debugId: 'debug-preload-1',
    });
  });
});

