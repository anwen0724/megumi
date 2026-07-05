/*
 * Shared runtime error utilities for host and product boundary code.
 * This is not run state; it only normalizes unknown failures into RuntimeError.
 */
import type {
  RuntimeError,
  RuntimeErrorSource,
} from '@megumi/shared/runtime';

export interface RuntimeExceptionOptions {
  cause?: unknown;
}

export interface NormalizeRuntimeErrorOptions {
  source: RuntimeErrorSource;
  debugId: string;
  fallbackMessage?: string;
}

export class RuntimeException extends Error {
  public readonly runtimeError: RuntimeError;
  public override readonly cause?: unknown;

  public constructor(runtimeError: RuntimeError, options: RuntimeExceptionOptions = {}) {
    super(runtimeError.message);
    this.name = 'RuntimeException';
    this.runtimeError = runtimeError;
    this.cause = options.cause;
  }

  public toRuntimeError(): RuntimeError {
    return this.runtimeError;
  }
}

export function normalizeRuntimeError(
  error: unknown,
  options: NormalizeRuntimeErrorOptions,
): RuntimeError {
  if (error instanceof RuntimeException) {
    return error.toRuntimeError();
  }

  return {
    code: 'runtime_unknown',
    message: options.fallbackMessage ?? 'Unexpected runtime error.',
    severity: 'error',
    retryable: true,
    source: options.source,
    debugId: options.debugId,
  };
}

export function throwRuntimeError(error: RuntimeError): never {
  throw new RuntimeException(error);
}

export function assertRuntime(
  condition: unknown,
  error: RuntimeError,
): asserts condition {
  if (!condition) {
    throwRuntimeError(error);
  }
}
