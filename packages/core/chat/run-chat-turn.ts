import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { normalizeRuntimeError } from '../runtime-exception';
import {
  createRunCancelledEvent,
  createRunCompletedEvent,
  createRunFailedEvent,
  createRunStartedEvent,
} from './events';
import {
  type RunChatTurnInput,
  defaultChatRuntimeClock,
} from './types';

export async function* runChatTurn(input: RunChatTurnInput): AsyncIterable<RuntimeEvent> {
  const clock = input.clock ?? defaultChatRuntimeClock;
  const runId = input.runIdFactory?.() ?? `run:${input.request.requestId}`;
  const eventIdFactory = input.eventIdFactory ?? (() => `event:${crypto.randomUUID()}`);
  let sequence = 0;
  let terminalEmitted = false;
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  if (input.signal?.aborted) {
    yield createRunCancelledEvent({
      eventId: eventIdFactory(),
      request: input.request,
      runId,
      sequence: nextSequence(),
      reason: 'Chat request was cancelled before it started.',
      createdAt: clock.now(),
    });
    return;
  }

  yield createRunStartedEvent({
    eventId: eventIdFactory(),
    request: input.request,
    runId,
    sequence: nextSequence(),
    createdAt: clock.now(),
  });

  try {
    for await (const event of input.aiPort.streamChat({
      request: input.request,
      runId,
      signal: input.signal,
      nextSequence,
      eventIdFactory,
    })) {
      yield event;
      terminalEmitted =
        event.eventType === 'run.failed' ||
        event.eventType === 'run.cancelled' ||
        event.eventType === 'run.completed';
    }

    if (!terminalEmitted) {
      yield createRunCompletedEvent({
        eventId: eventIdFactory(),
        request: input.request,
        runId,
        sequence: nextSequence(),
        createdAt: clock.now(),
      });
    }
  } catch (error) {
    yield createRunFailedEvent({
      eventId: eventIdFactory(),
      request: input.request,
      runId,
      sequence: nextSequence(),
      createdAt: clock.now(),
      error: normalizeRuntimeError(error, {
        source: 'core',
        debugId: input.request.runtimeContext?.debugId ?? `debug:${input.request.requestId}`,
        fallbackMessage: 'Chat runtime failed.',
      }),
    });
  }
}
