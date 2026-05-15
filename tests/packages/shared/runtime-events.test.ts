import { describe, expect, it } from 'vitest';
import {
  ContextPatchRequestedEventSchema,
  RuntimeEventSchema,
  RuntimeEventTypeSchema,
  isTerminalRuntimeEvent,
  createRuntimeEventSchema,
} from '@megumi/shared/runtime-event-schemas';
import {
  createContextPatchRequestedEvent,
  createRunStartedEvent,
  createRuntimeEvent,
} from '@megumi/shared/runtime-event-factory';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

const runtimeContext = {
  requestId: 'ipc-chat-start-1',
  traceId: 'trace-runtime-1',
  debugId: 'debug-runtime-1',
  operationName: 'chat.start',
  source: 'renderer',
  createdAt: '2026-05-12T10:00:00.000Z',
} as const;

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

  it('accepts optional runtime context on event envelopes', () => {
    const event = RuntimeEventSchema.parse({
      eventId: 'event-with-context',
      schemaVersion: 1,
      eventType: 'run.started',
      runId: 'run-1',
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      sequence: 1,
      createdAt: '2026-05-12T10:00:01.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'required',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runKind: 'chat',
      },
    });

    expect(event.context).toEqual(runtimeContext);
  });

  it('copies runtime context from ChatRuntimeRequest when creating runtime events', () => {
    const event = createRunStartedEvent({
      eventId: 'event-from-factory',
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-05-12T10:00:01.000Z',
      request: {
        requestId: 'ipc-chat-start-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        createdAt: '2026-05-12T10:00:00.000Z',
        runtimeContext,
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'Hello',
            createdAt: '2026-05-12T10:00:00.000Z',
          },
        ],
      },
    });

    expect(event).toMatchObject({
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
    });
  });
});

describe('agent lifecycle runtime events', () => {
  it('accepts session.created events without a run id', () => {
    const event = RuntimeEventSchema.parse({
      eventId: 'event-session-1',
      schemaVersion: 1,
      eventType: 'session.created',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-05-15T00:00:00.000Z',
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        title: 'Agent work',
        status: 'active',
      },
    });

    expect(event).toMatchObject({
      eventType: 'session.created',
      sessionId: 'session-1',
    });
    expect(event).not.toHaveProperty('runId');
  });

  it('accepts 02 lifecycle events with lifecycle ids', () => {
    const event = RuntimeEventSchema.parse({
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'step.status.changed',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-15T00:00:00.000Z',
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        from: 'running',
        to: 'succeeded',
      },
    });

    expect(event.eventType).toBe('step.status.changed');
    expect(event.stepId).toBe('step-1');
  });

  it('keeps message.delta separate from assistant.output.delta', () => {
    expect(RuntimeEventSchema.parse({
      eventId: 'event-2',
      schemaVersion: 1,
      eventType: 'message.delta',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 2,
      createdAt: '2026-05-15T00:00:00.000Z',
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        messageId: 'message-1',
        delta: 'Hello',
      },
    }).eventType).toBe('message.delta');
  });
});

describe('context runtime events', () => {
  it('registers context patch requested events in shared schemas', () => {
    const event = {
      eventId: 'event-context-1',
      schemaVersion: 1,
      eventType: 'context.patch.requested',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      sequence: 1,
      createdAt: '2026-05-15T00:00:00.000Z',
      source: 'core',
      visibility: 'debug',
      persist: 'required',
      payload: {
        patchId: 'patch-1',
        operation: 'add',
        requestedBy: 'agent',
        reason: 'Need package contracts for this task.',
      },
    };

    expect(ContextPatchRequestedEventSchema.parse(event)).toMatchObject({
      eventType: 'context.patch.requested',
      payload: { patchId: 'patch-1' },
    });
    expect(RuntimeEventSchema.parse(event).eventType).toBe('context.patch.requested');
  });

  it('creates typed context events with runtime context propagation', () => {
    const event = createContextPatchRequestedEvent({
      eventId: 'event-context-2',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      sequence: 2,
      createdAt: '2026-05-15T00:00:00.000Z',
      runtimeContext: {
        requestId: 'request-1',
        traceId: 'trace-1',
        operationName: 'agent.context.patch.request',
        source: 'core',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
      payload: {
        patchId: 'patch-1',
        operation: 'add',
        requestedBy: 'agent',
        reason: 'Need package contracts for this task.',
      },
    });

    expect(event.context?.traceId).toBe('trace-1');
    expect(event.requestId).toBe('request-1');
    expect(JSON.stringify(event)).not.toContain('sk-test');
  });

  it('keeps generic runtime factory compatible with context events', () => {
    const event = createRuntimeEvent({
      eventId: 'event-context-3',
      eventType: 'context.effective.updated',
      runId: 'run-1',
      sequence: 3,
      createdAt: '2026-05-15T00:00:00.000Z',
      source: 'core',
      visibility: 'debug',
      persist: 'required',
      payload: {
        contextId: 'context-1',
        effectiveContextBuildId: 'build-1',
        sourceCount: 1,
        redactionCount: 0,
        truncationCount: 0,
      },
    });

    expect(event.eventType).toBe('context.effective.updated');
  });
});
