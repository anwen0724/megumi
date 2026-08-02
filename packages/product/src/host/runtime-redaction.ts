/* Keeps Host error details redacted without exposing Observability internals to Host callers. */

import { redactRuntimeValue } from '@megumi/observability/redaction';

export function redactHostRuntimeValue<T>(value: T): T {
  return redactRuntimeValue(value);
}
