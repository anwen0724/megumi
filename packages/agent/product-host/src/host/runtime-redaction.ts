/* Keeps Host error details redacted without exposing Observability internals to Host callers. */

import { redactRuntimeDetails } from '@megumi/observability/redaction';

/** Redacts one Host-owned runtime detail object before it crosses into logging. */
export function redactHostRuntimeValue(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return redactRuntimeDetails(value) ?? {};
}
