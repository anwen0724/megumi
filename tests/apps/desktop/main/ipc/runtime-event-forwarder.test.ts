// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { forwardRuntimeEvents } from '@megumi/desktop/main/ipc/runtime-event-forwarder';

const runtimeContext = {
  requestId: 'ipc-chat-start-1',
  traceId: 'trace-forward-1',
  debugId: 'debug-forward-1',
  operationName: 'session.message.send',
  source: 'main',
  createdAt: '2026-05-12T00:00:00.000Z',
} as const;

async function* stream(events: unknown[]): AsyncIterable<RuntimeEvent> {
  for (const event of events) {
    yield event as RuntimeEvent;
  }
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('forwardRuntimeEvents', () => {
  it('validates and forwards runtime events with context unchanged', async () => {
    const sender = { send: vi.fn() };
    const logger = createLogger();
    const event: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'run.started',
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-05-12T00:00:01.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'required',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runKind: 'chat',
      },
    };

    await forwardRuntimeEvents(sender, stream([event]), { logger });

    expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, event);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('drops invalid runtime events and logs redacted diagnostics', async () => {
    const sender = { send: vi.fn() };
    const logger = createLogger();
    const obsoleteRuntimeErrorField = ['recover', 'able'].join('');
    const invalidEvent = {
      eventId: 'event-invalid',
      schemaVersion: 1,
      eventType: 'run.failed',
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-05-12T00:00:01.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'required',
      payload: {
        error: {
          code: 'provider_auth_failed',
          message: 'Authorization: Bearer sk-raw-secret',
          severity: 'error',
          retryable: false,
          source: 'provider',
          [obsoleteRuntimeErrorField]: false,
        },
      },
    };

    await forwardRuntimeEvents(sender, stream([invalidEvent]), { logger });

    expect(sender.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'runtime_event_invalid',
      expect.objectContaining({
        eventType: 'run.failed',
        requestId: 'ipc-chat-start-1',
        traceId: 'trace-forward-1',
        debugId: 'debug-forward-1',
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-raw-secret');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(obsoleteRuntimeErrorField);
  });

  it('logs send failures without exposing raw event payload', async () => {
    const sender = {
      send: vi.fn(() => {
        throw new Error('send failed with sk-send-secret');
      }),
    };
    const logger = createLogger();
    const event: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'assistant.output.delta',
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      runId: 'run-1',
      sequence: 2,
      createdAt: '2026-05-12T00:00:02.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'transient',
      payload: {
        delta: 'Hello',
      },
    };

    await forwardRuntimeEvents(sender, stream([event]), { logger });

    expect(logger.error).toHaveBeenCalledWith(
      'runtime_event_send_failed',
      expect.objectContaining({
        eventId: 'event-1',
        eventType: 'assistant.output.delta',
        requestId: 'ipc-chat-start-1',
        traceId: 'trace-forward-1',
        debugId: 'debug-forward-1',
        message: 'Runtime event delivery failed.',
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk-send-secret');
  });
});
