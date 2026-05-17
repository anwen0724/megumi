// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import { runChatTurn } from '@megumi/core/chat/run-chat-turn';
import type { AiChatPort } from '@megumi/core/ports/ai-port';
import {
  createAssistantCompletedEvent,
  createAssistantDeltaEvent,
} from '@megumi/core/chat/events';

const request: ChatRuntimeRequest = {
  requestId: 'request-1',
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  createdAt: '2026-05-11T00:00:00.000Z',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: 'Hello',
      createdAt: '2026-05-11T00:00:00.000Z',
    },
  ],
};

const runtimeContext = {
  requestId: 'request-1',
  traceId: 'trace-chat-1',
  debugId: 'debug-chat-1',
  operationName: 'session.message.send',
  source: 'main',
  createdAt: '2026-05-11T00:00:00.000Z',
} as const;

const requestWithRuntimeContext: ChatRuntimeRequest = {
  ...request,
  runtimeContext,
};

let eventIds = 1;

beforeEach(() => {
  eventIds = 1;
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

describe('runChatTurn', () => {
  const clock = { now: () => '2026-05-12T10:00:00.000Z' };

  it('emits run lifecycle events, delegates to the AI port, and assigns sequences', async () => {
    const aiPort: AiChatPort = {
      async *streamChat(input) {
        expect(input.request).toBe(request);
        expect(input.runId).toBe('run-1');
        expect(input.nextSequence()).toBe(2);

        yield createAssistantDeltaEvent({
          eventId: input.eventIdFactory(),
          request,
          runId: input.runId,
          sequence: 2,
          delta: 'Hello',
          createdAt: clock.now(),
        });
        yield createAssistantCompletedEvent({
          eventId: input.eventIdFactory(),
          request,
          runId: input.runId,
          sequence: input.nextSequence(),
          createdAt: clock.now(),
          payload: {
            content: 'Hello',
          },
        });
      },
    };

    const events = await collect(runChatTurn({
      request,
      aiPort,
      runIdFactory: () => 'run-1',
      eventIdFactory: () => `event-${eventIds++}`,
      clock,
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'run.started',
      'assistant.output.delta',
      'assistant.output.completed',
      'run.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events[0]).toMatchObject({
      eventType: 'run.started',
      runId: 'run-1',
      requestId: 'request-1',
      visibility: 'system',
      persist: 'required',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runKind: 'chat',
      },
    });
  });

  it('emits cancelled without calling the AI port when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    let called = false;
    const aiPort: AiChatPort = {
      async *streamChat() {
        called = true;
      },
    };

    const events = await collect(runChatTurn({
      request,
      aiPort,
      signal: controller.signal,
      runIdFactory: () => 'run-1',
      eventIdFactory: () => `event-${eventIds++}`,
      clock,
    }));

    expect(called).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'run.cancelled',
        requestId: 'request-1',
        runId: 'run-1',
        sequence: 1,
        payload: {
          reason: 'Chat request was cancelled before it started.',
        },
      }),
    ]);
  });

  it('emits run.failed when the provider throws', async () => {
    const aiPort: AiChatPort = {
      async *streamChat() {
        throw new Error('network exploded');
      },
    };

    const events = await collect(runChatTurn({
      request,
      aiPort,
      runIdFactory: () => 'run-1',
      eventIdFactory: () => `event-${eventIds++}`,
      clock,
    }));

    expect(events.map((event) => event.eventType)).toEqual(['run.started', 'run.failed']);
    expect(events[1]).toMatchObject({
      eventType: 'run.failed',
      payload: {
        error: {
          code: 'runtime_unknown',
          message: 'Chat runtime failed.',
          source: 'core',
        },
      },
    });
  });

  it('propagates runtime context to all lifecycle and provider events', async () => {
    const aiPort: AiChatPort = {
      async *streamChat(input) {
        yield createAssistantDeltaEvent({
          eventId: input.eventIdFactory(),
          request: input.request,
          runId: input.runId,
          sequence: input.nextSequence(),
          delta: 'Hello',
          createdAt: clock.now(),
        });
      },
    };

    const events = await collect(runChatTurn({
      request: requestWithRuntimeContext,
      aiPort,
      runIdFactory: () => 'run-1',
      eventIdFactory: () => `event-${eventIds++}`,
      clock,
    }));

    expect(events.map((event) => event.context)).toEqual([
      runtimeContext,
      runtimeContext,
      runtimeContext,
    ]);
  });

  it('normalizes thrown provider errors into display-safe failed events with debug id', async () => {
    const aiPort: AiChatPort = {
      async *streamChat() {
        throw new Error('network exploded with sk-raw-secret');
      },
    };

    const events = await collect(runChatTurn({
      request: requestWithRuntimeContext,
      aiPort,
      runIdFactory: () => 'run-1',
      eventIdFactory: () => `event-${eventIds++}`,
      clock,
    }));

    expect(events[1]).toMatchObject({
      eventType: 'run.failed',
      context: runtimeContext,
      payload: {
        error: {
          code: 'runtime_unknown',
          message: 'Chat runtime failed.',
          severity: 'error',
          retryable: true,
          source: 'core',
          debugId: 'debug-chat-1',
        },
      },
    });
    expect(JSON.stringify(events)).not.toContain('sk-raw-secret');
    expect(JSON.stringify(events)).not.toContain('network exploded');
  });
});
