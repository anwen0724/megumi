/* Enforces the metadata allowlist before a record enters the buffer. */
import type { ObservabilityAttributes } from "../../domain/model/observability-record";

const SAFE_KEYS = new Set([
  "providerId",
  "modelId",
  "protocol",
  "stopReason",
  "toolName",
  "decision",
  "reasonCode",
  "role",
  "messageKind",
  "sourceCount",
  "turnCount",
  "retainedTurnCount",
  "compactedTurnCount",
  "contextWindowTokens",
  "thresholdRatio",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "beforeTokens",
  "afterTokens",
  "resultBytes",
  "modelCallCount",
  "toolCallCount",
  "droppedRecordCount",
  "status",
  "operation",
  "channel",
  "code",
  "component",
  "cancelled",
  "automatic",
  "configured",
]);
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/;
export function sanitizeObservabilityAttributes(
  value?: Readonly<Record<string, unknown>>,
): ObservabilityAttributes {
  if (!value) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_KEYS.has(key)) continue;
    if (item === null || typeof item === "number" || typeof item === "boolean")
      safe[key] = item;
    else if (typeof item === "string" && !ABSOLUTE_PATH.test(item))
      safe[key] = item.slice(0, 256);
  }
  return safe;
}
export function sanitizeEventName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128);
}
