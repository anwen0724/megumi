import type { RuntimeError } from '@megumi/shared/runtime-errors';
import { RuntimeException } from './runtime-exception';

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
