// Extracts business payloads from renderer RuntimeIpcRequest envelopes at the desktop IPC boundary.
export function unwrapRendererRuntimePayload(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const meta = value.meta;
  if (
    typeof value.requestId === 'string'
    && isRecord(meta)
    && typeof meta.channel === 'string'
    && meta.source === 'renderer'
    && Object.prototype.hasOwnProperty.call(value, 'payload')
  ) {
    return value.payload;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
