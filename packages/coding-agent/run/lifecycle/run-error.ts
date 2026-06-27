import type {
  RuntimeError,
  RuntimeErrorSource,
} from '@megumi/shared/runtime';
import type { RunTerminalReason } from '@megumi/shared/session';

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

export function createTerminalRuntimeError(input: {
  reason: RunTerminalReason;
  code: RuntimeError['code'];
  message: string;
  source: RuntimeError['source'];
  retryable?: boolean;
  debugId?: string;
  details?: Record<string, unknown>;
}): RuntimeError {
  return {
    code: input.code,
    message: input.message,
    severity: 'error',
    retryable: input.retryable ?? false,
    source: input.source,
    ...(input.debugId ? { debugId: input.debugId } : {}),
    details: {
      ...(input.details ?? {}),
      reason: input.reason,
    },
  };
}

