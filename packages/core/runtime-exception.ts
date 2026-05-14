import type {
  RuntimeError,
  RuntimeErrorSource,
} from '@megumi/shared/runtime-errors';

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
