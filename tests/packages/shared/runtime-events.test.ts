import { describe, expect, it } from 'vitest';
import {
  RuntimeEventSchema,
  RuntimeEventTypeSchema,
  isTerminalRuntimeEvent,
  createRuntimeEventSchema,
} from '@megumi/shared/runtime-event-schemas';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

describe('runtime event contracts', () => {
  it('accepts run.started events', () => {
    const event = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'run.started',
      runId: 'run-1',
      sessionId: 'session-1',
      requestId: 'ipc-chat-1',
      sequence: 1,
      createdAt: '2026-05-12T10:00:00.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'required',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runKind: 'chat',
      },
    } satisfies RuntimeEvent<{ providerId: string; modelId: string; runKind: 'chat' }>;

    expect(RuntimeEventSchema.parse(event)).toEqual(event);
  });

  it('accepts assistant delta events', () => {
    expect(
      RuntimeEventSchema.parse({
        eventId: 'event-2',
        schemaVersion: 1,
        eventType: 'assistant.output.delta',
        runId: 'run-1',
        sequence: 2,
        createdAt: '2026-05-12T10:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'transient',
        payload: {
          delta: 'Hello',
        },
      }).payload,
    ).toEqual({ delta: 'Hello' });
  });

  it('accepts run.failed with RuntimeError payload', () => {
    const event = RuntimeEventSchema.parse({
      eventId: 'event-3',
      schemaVersion: 1,
      eventType: 'run.failed',
      runId: 'run-1',
      sequence: 3,
      createdAt: '2026-05-12T10:00:02.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'required',
      payload: {
        error: {
          code: 'provider_auth_failed',
          message: 'Provider rejected the API key.',
          severity: 'error',
          retryable: false,
          source: 'provider',
        },
      },
    });

    expect(event).toMatchObject({
      payload: {
        error: {
          code: 'provider_auth_failed',
        },
      },
    });
  });

  it('rejects invalid sequence values', () => {
    expect(() =>
      RuntimeEventSchema.parse({
        eventId: 'event-4',
        schemaVersion: 1,
        eventType: 'run.started',
        runId: 'run-1',
        sequence: 0,
        createdAt: '2026-05-12T10:00:00.000Z',
        source: 'core',
        visibility: 'system',
        persist: 'required',
        payload: {
          runKind: 'chat',
        },
      }),
    ).toThrow();
  });

  it('identifies terminal event types', () => {
    expect(isTerminalRuntimeEvent('run.completed')).toBe(true);
    expect(isTerminalRuntimeEvent('run.failed')).toBe(true);
    expect(isTerminalRuntimeEvent('run.cancelled')).toBe(true);
    expect(isTerminalRuntimeEvent('assistant.output.delta')).toBe(false);
  });

  it('checks event type names', () => {
    expect(RuntimeEventTypeSchema.parse('tool.call.completed')).toBe('tool.call.completed');
    expect(() => RuntimeEventTypeSchema.parse('completed')).toThrow();
  });

  it('creates typed event schemas', () => {
    const schema = createRuntimeEventSchema('assistant.output.delta', {
      delta: 'hi',
    });

    expect(schema.eventType).toBe('assistant.output.delta');
    expect(schema.payload).toEqual({ delta: 'hi' });
  });
});
