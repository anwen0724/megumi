/*
 * Runtime event stream transforms that do not own queues or business state.
 */
import type { RuntimeEvent } from './runtime-event';

const TEXT_DELTA_FLUSH_DELAY_MS = 50;
const TEXT_DELTA_MAX_CHARS = 512;

export async function* coalesceTextDeltaRuntimeEvents(
  events: AsyncIterable<RuntimeEvent>,
  options: { flushDelayMs?: number; maxChars?: number } = {},
): AsyncIterable<RuntimeEvent> {
  const flushDelayMs = options.flushDelayMs ?? TEXT_DELTA_FLUSH_DELAY_MS;
  const maxChars = options.maxChars ?? TEXT_DELTA_MAX_CHARS;
  const iterator = events[Symbol.asyncIterator]();
  let pendingNext = iterator.next();
  let bufferedEvent: RuntimeEvent | null = null;
  let bufferedDelta = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<'flush'> | null = null;

  const clearFlushTimer = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    flushPromise = null;
  };
  const startFlushTimer = () => {
    if (flushPromise) return;
    flushPromise = new Promise((resolve) => {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushPromise = null;
        resolve('flush');
      }, flushDelayMs);
    });
  };
  const flush = (): RuntimeEvent | null => {
    if (!bufferedEvent) return null;
    const event = withTextDelta(bufferedEvent, bufferedDelta);
    bufferedEvent = null;
    bufferedDelta = '';
    clearFlushTimer();
    return event;
  };
  const buffer = (event: RuntimeEvent) => {
    bufferedEvent = event;
    bufferedDelta = getDelta(event.payload);
    startFlushTimer();
  };

  while (true) {
    if (!bufferedEvent) {
      const result = await pendingNext;
      pendingNext = iterator.next();
      if (result.done) return;
      if (isTextDeltaRuntimeEvent(result.value)) {
        buffer(result.value);
        if (bufferedDelta.length >= maxChars) {
          const event = flush();
          if (event) yield event;
        }
      } else {
        yield result.value;
      }
      continue;
    }

    const result = await Promise.race([
      pendingNext.then((next) => ({ kind: 'next' as const, next })),
      (flushPromise ?? Promise.resolve('flush')).then(() => ({ kind: 'flush' as const })),
    ]);
    if (result.kind === 'flush') {
      const event = flush();
      if (event) yield event;
      continue;
    }
    pendingNext = iterator.next();
    if (result.next.done) {
      const event = flush();
      if (event) yield event;
      return;
    }
    if (canMergeTextDelta(bufferedEvent, result.next.value)) {
      bufferedDelta += getDelta(result.next.value.payload);
      if (bufferedDelta.length >= maxChars) {
        const event = flush();
        if (event) yield event;
      }
      continue;
    }
    const event = flush();
    if (event) yield event;
    if (isTextDeltaRuntimeEvent(result.next.value)) buffer(result.next.value);
    else yield result.next.value;
  }
}

function isTextDeltaRuntimeEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'assistant.output.delta' || event.eventType === 'model_call.text_delta';
}
function canMergeTextDelta(left: RuntimeEvent, right: RuntimeEvent): boolean {
  if (!isTextDeltaRuntimeEvent(left) || !isTextDeltaRuntimeEvent(right) || left.eventType !== right.eventType) return false;
  if (left.eventType === 'model_call.text_delta') {
    return (left.payload as { modelCallId?: unknown }).modelCallId
      === (right.payload as { modelCallId?: unknown }).modelCallId;
  }
  return true;
}
function withTextDelta(event: RuntimeEvent, delta: string): RuntimeEvent {
  return { ...event, payload: { ...(event.payload as Record<string, unknown>), delta } };
}
function getDelta(payload: RuntimeEvent['payload']): string {
  const delta = (payload as { delta?: unknown }).delta;
  return typeof delta === 'string' ? delta : '';
}
