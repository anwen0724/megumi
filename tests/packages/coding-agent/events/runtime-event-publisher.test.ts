import { describe, expect, it, vi } from 'vitest';

import { RuntimeEventLog, RuntimeEventPublisher } from '@megumi/coding-agent/events';
import type { RuntimeEvent } from '@megumi/shared/runtime';

describe('RuntimeEventPublisher', () => {
  it('publishes runtime-request events through stream and terminal hooks', () => {
    const repository = new InMemoryRuntimeEventRepository([
      runtimeEvent({ eventId: 'event-1', sequence: 3 }),
    ]);
    const terminalHooks = { publishRunTerminalHooks: vi.fn() };
    const chatStreamAdapter = {
      handleRuntimeEvent: vi.fn(),
      dispose: vi.fn(),
    };
    const publisher = new RuntimeEventPublisher({
      eventLog: new RuntimeEventLog(repository),
      terminalHooks,
    });

    const appended = publisher.appendWithRuntimeRequest(
      runtimeEvent({
        eventId: 'event-2',
        eventType: 'run.completed',
        sequence: 1,
      }),
      {
        requestId: 'request-1',
        runtimeContext: {
          requestId: 'request-1',
          traceId: 'trace-1',
          operationName: 'session.message.send',
          source: 'main',
          createdAt: '2026-06-29T00:00:00.000Z',
        },
      },
      { chatStreamAdapter },
    );

    expect(appended).toMatchObject({
      eventId: 'event-2',
      sequence: 4,
      requestId: 'request-1',
      context: { traceId: 'trace-1' },
    });
    expect(chatStreamAdapter.handleRuntimeEvent).toHaveBeenCalledWith(appended);
    expect(chatStreamAdapter.dispose).toHaveBeenCalledTimes(1);
    expect(terminalHooks.publishRunTerminalHooks).toHaveBeenCalledWith({
      event: appended,
      chatStreamAdapter,
    });
  });

  it('publishes raw runtime events through the same terminal hook boundary', () => {
    const terminalHooks = { publishRunTerminalHooks: vi.fn() };
    const publisher = new RuntimeEventPublisher({
      eventLog: new RuntimeEventLog(new InMemoryRuntimeEventRepository()),
      terminalHooks,
    });
    const event = runtimeEvent({
      eventId: 'event-raw',
      eventType: 'run.failed',
      sequence: 1,
    });

    publisher.append(event);

    expect(terminalHooks.publishRunTerminalHooks).toHaveBeenCalledWith({
      event,
    });
  });
});

class InMemoryRuntimeEventRepository {
  constructor(private readonly events: RuntimeEvent[] = []) {}

  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
    this.events.push(event);
    return event;
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.events
      .filter((event) => event.runId === runId)
      .sort((left, right) => left.sequence - right.sequence);
  }
}

function runtimeEvent(input: Partial<RuntimeEvent> & {
  eventId: string;
  sequence: number;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType ?? 'run.started',
    runId: input.runId ?? 'run-1',
    sessionId: input.sessionId ?? 'session-1',
    sequence: input.sequence,
    createdAt: input.createdAt ?? '2026-06-29T00:00:00.000Z',
    source: input.source ?? 'core',
    visibility: input.visibility ?? 'user',
    persist: input.persist ?? 'required',
    payload: input.payload ?? {},
  };
}
