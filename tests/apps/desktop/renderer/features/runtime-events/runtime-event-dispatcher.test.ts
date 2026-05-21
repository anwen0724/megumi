// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useApprovalStore } from '@megumi/desktop/renderer/entities/approval';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useToolCallStore } from '@megumi/desktop/renderer/entities/tool-call';
import { dispatchRuntimeEvent } from '@megumi/desktop/renderer/features/runtime-events/runtime-event-dispatcher';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

function runtimeEvent(
  eventType: RuntimeEvent['eventType'],
  sequence: number,
  payload: RuntimeEvent['payload'] = {},
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    eventId: `event-${sequence}`,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    createdAt: `2026-05-17T00:00:0${sequence}.000Z`,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
    ...overrides,
  } as RuntimeEvent;
}

describe('runtime event dispatcher', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      streamingText: '',
      isStreaming: false,
      pendingToolCalls: [],
      completedToolActivities: [],
      agentStatus: 'idle',
      lastError: null,
      sessionSnapshots: {},
    });
    useRunStore.getState().resetRuns();
    useToolCallStore.getState().reset();
    useApprovalStore.getState().reset();
  });

  it('applies stream events to run state and commits completed assistant content', () => {
    dispatchRuntimeEvent(runtimeEvent('run.started', 1, {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      runKind: 'chat',
    }));
    dispatchRuntimeEvent(runtimeEvent('assistant.output.delta', 2, { delta: 'Hello ' }));
    dispatchRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: 'Megumi' }));
    dispatchRuntimeEvent(runtimeEvent('assistant.output.completed', 4, { content: 'Hello Megumi.' }));
    dispatchRuntimeEvent(runtimeEvent('run.completed', 5));

    expect(useRunStore.getState().runs['run-1']).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      status: 'completed',
      updatedAt: '2026-05-17T00:00:05.000Z',
    });
    expect(useRunStore.getState().eventsByRun['run-1'].map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(useChatStore.getState()).toMatchObject({
      streamingText: '',
      isStreaming: false,
      agentStatus: 'idle',
      lastError: null,
    });
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'Hello Megumi.',
      }),
    ]);
  });

  it('falls back to streaming text then Done when a run completes without completed content', () => {
    dispatchRuntimeEvent(runtimeEvent('assistant.output.delta', 1, { delta: 'Streamed answer' }));
    dispatchRuntimeEvent(runtimeEvent('run.completed', 2));
    dispatchRuntimeEvent(runtimeEvent('run.completed', 3, {}, { runId: 'run-2' }));

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'Streamed answer',
      'Done.',
    ]);
  });

  it('adds failed and cancelled assistant messages and uses the default cancellation reason', () => {
    dispatchRuntimeEvent(runtimeEvent('run.failed', 1, {
      error: {
        code: 'provider_disabled',
        message: 'Provider is disabled.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    }));
    dispatchRuntimeEvent(runtimeEvent('run.cancelled', 2));

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'Provider is disabled.',
      'Session message was cancelled.',
    ]);
    expect(useChatStore.getState()).toMatchObject({
      agentStatus: 'idle',
      lastError: 'Session message was cancelled.',
      streamingText: '',
    });
    expect(useRunStore.getState().lastError).toBe('Provider is disabled.');
  });

  it('does not apply duplicate runtime events to chat timeline state', () => {
    const delta = runtimeEvent('assistant.output.delta', 1, { delta: 'Hello' });
    const completed = runtimeEvent('assistant.output.completed', 2, { content: 'Hello.' });
    const runCompleted = runtimeEvent('run.completed', 3);

    dispatchRuntimeEvent(delta);
    dispatchRuntimeEvent(delta);
    dispatchRuntimeEvent(completed);
    dispatchRuntimeEvent(completed);
    dispatchRuntimeEvent(runCompleted);
    dispatchRuntimeEvent(runCompleted);

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['Hello.']);
    expect(useChatStore.getState().streamingText).toBe('');
    expect(useRunStore.getState().eventsByRun['run-1'].map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('ignores events without run ids for run and chat state', () => {
    dispatchRuntimeEvent(runtimeEvent('run.started', 1, {}, { runId: undefined }));

    expect(useRunStore.getState()).toMatchObject({
      activeRunId: null,
      runs: {},
      eventsByRun: {},
    });
    expect(useChatStore.getState().agentStatus).toBe('idle');
  });

  it('stores non-output runtime events for renderer processing disclosure without changing chat messages', () => {
    dispatchRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    dispatchRuntimeEvent(runtimeEvent('context.effective.updated', 2, { sourceCount: 2 }));
    dispatchRuntimeEvent(runtimeEvent('tool.call.completed', 3, {
      toolCallId: 'tool-call-1',
      toolName: 'workspace.read',
      resultPreview: { files: 2 },
      durationMs: 800,
    }));
    dispatchRuntimeEvent(runtimeEvent('artifact.created', 4, {
      artifactId: 'artifact-1',
      kind: 'report',
      title: 'UI report',
      status: 'draft',
    }));

    expect(useRunStore.getState().eventsByRun['run-1'].map((event) => event.eventType)).toEqual([
      'run.started',
      'context.effective.updated',
      'tool.call.completed',
      'artifact.created',
    ]);
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('projects tool call events into the renderer tool-call store', () => {
    dispatchRuntimeEvent(runtimeEvent('tool.call.requested', 1, {
      toolCall: {
        toolCallId: 'tool-call-1',
        toolUseId: 'tool-use-1',
        runId: 'run-1',
        stepId: 'step-1',
        actionId: 'action-1',
        toolName: 'read_file',
        input: { path: 'README.md' },
        inputPreview: {
          summary: 'Read README.md',
          targets: [{ kind: 'file', label: 'README.md', sensitivity: 'normal' }],
          redactionState: 'none',
        },
        capabilities: ['project_read'],
        riskLevel: 'low',
        sideEffect: 'none',
        status: 'requested',
        requestedAt: '2026-05-20T00:00:00.000Z',
      },
    }));
    dispatchRuntimeEvent(runtimeEvent('tool.call.started', 2, {
      toolCallId: 'tool-call-1',
      startedAt: '2026-05-20T00:00:01.000Z',
    }));

    expect(useToolCallStore.getState().toolCallsById['tool-call-1']).toMatchObject({
      toolCallId: 'tool-call-1',
      status: 'running',
      startedAt: '2026-05-20T00:00:01.000Z',
    });
    expect(useChatStore.getState().agentStatus).toBe('running');
  });

  it('projects approval events and waiting status into renderer stores', () => {
    dispatchRuntimeEvent(runtimeEvent('approval.requested', 1, {
      approvalRequest: {
        approvalRequestId: 'approval-1',
        toolUseId: 'tool-use-1',
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        stepId: 'step-1',
        toolName: 'edit_file',
        capabilities: ['project_write'],
        riskLevel: 'medium',
        title: 'Edit file',
        summary: 'Edit src/app.ts',
        preview: {
          action: 'Edit file',
          targets: [{ kind: 'file', label: 'src/app.ts', sensitivity: 'normal' }],
        },
        requestedScope: 'once',
        status: 'pending',
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    }));
    dispatchRuntimeEvent(runtimeEvent('run.status.changed', 2, {
      from: 'running',
      to: 'waiting_for_approval',
    }));
    dispatchRuntimeEvent(runtimeEvent('approval.resolved', 3, {
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-05-20T00:00:02.000Z',
    }));

    expect(useApprovalStore.getState().approvalRequestsById['approval-1']).toMatchObject({
      status: 'approved',
      resolvedAt: '2026-05-20T00:00:02.000Z',
    });
    expect(useChatStore.getState().agentStatus).toBe('running');
  });

  it('does not project duplicate tool events twice', () => {
    const requested = runtimeEvent('tool.call.requested', 1, {
      toolCall: {
        toolCallId: 'tool-call-1',
        toolUseId: 'tool-use-1',
        runId: 'run-1',
        stepId: 'step-1',
        toolName: 'read_file',
        input: { path: 'README.md' },
        inputPreview: {
          summary: 'Read README.md',
          targets: [{ kind: 'file', label: 'README.md', sensitivity: 'normal' }],
          redactionState: 'none',
        },
        capabilities: ['project_read'],
        riskLevel: 'low',
        sideEffect: 'none',
        status: 'requested',
        requestedAt: '2026-05-20T00:00:00.000Z',
      },
    });
    const started = runtimeEvent('tool.call.started', 2, {
      toolCallId: 'tool-call-1',
      startedAt: '2026-05-20T00:00:01.000Z',
    });
    const duplicateStartedWithDifferentCreatedAt = {
      ...started,
      createdAt: '2026-05-20T00:00:09.000Z',
      payload: {
        toolCallId: 'tool-call-1',
      },
    } as RuntimeEvent;

    dispatchRuntimeEvent(requested);
    dispatchRuntimeEvent(requested);
    dispatchRuntimeEvent(started);
    dispatchRuntimeEvent(duplicateStartedWithDifferentCreatedAt);

    expect(useToolCallStore.getState().toolCallsById['tool-call-1']).toMatchObject({
      status: 'running',
      startedAt: '2026-05-20T00:00:01.000Z',
    });
  });
});

describe('useRunStore', () => {
  beforeEach(() => {
    useRunStore.getState().resetRuns();
  });

  it('deduplicates events by event id or sequence and sorts by sequence', () => {
    const store = useRunStore.getState();

    store.applyRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: 'late' }));
    store.applyRuntimeEvent(runtimeEvent('run.started', 1, {}, { eventId: 'same-event' }));
    store.applyRuntimeEvent(runtimeEvent('run.started', 2, {}, { eventId: 'same-event' }));
    store.applyRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: 'duplicate sequence' }, { eventId: 'different-event' }));

    expect(useRunStore.getState().eventsByRun['run-1'].map((event) => event.sequence)).toEqual([1, 3]);
  });

  it('updates run status from terminal and status changed events', () => {
    const store = useRunStore.getState();

    store.applyRuntimeEvent(runtimeEvent('run.started', 1));
    store.applyRuntimeEvent(runtimeEvent('run.status.changed', 2, { from: 'running', to: 'queued' }));
    store.applyRuntimeEvent(runtimeEvent('run.cancelled', 3, { reason: 'Stopped' }));

    expect(useRunStore.getState().runs['run-1']).toMatchObject({
      status: 'cancelled',
      updatedAt: '2026-05-17T00:00:03.000Z',
    });
  });

  it('uses the shared run status contract for status changed events', () => {
    const store = useRunStore.getState();

    store.applyRuntimeEvent(runtimeEvent('run.status.changed', 1, {
      from: 'running',
      to: 'waiting_for_approval',
    }));
    store.applyRuntimeEvent(runtimeEvent('run.status.changed', 2, {
      from: 'waiting_for_approval',
      to: 'cancelling',
    }));

    expect(useRunStore.getState().runs['run-1']).toMatchObject({
      status: 'cancelling',
      updatedAt: '2026-05-17T00:00:02.000Z',
    });
  });

  it('tracks run step state from step status runtime events', () => {
    const store = useRunStore.getState();

    store.applyRuntimeEvent(runtimeEvent('step.created', 1, {
      kind: 'model',
      status: 'running',
      title: 'Model response',
    }, { stepId: 'step-1' }));
    store.applyRuntimeEvent(runtimeEvent('step.status.changed', 2, {
      from: 'running',
      to: 'failed',
    }, { stepId: 'step-1' }));
    store.applyRuntimeEvent(runtimeEvent('step.failed', 3, {
      kind: 'model',
      error: {
        code: 'provider_failed',
        message: 'Provider failed.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    }, { stepId: 'step-1' }));

    expect(useRunStore.getState().stepsByRun['run-1']?.['step-1']).toMatchObject({
      stepId: 'step-1',
      runId: 'run-1',
      kind: 'model',
      title: 'Model response',
      status: 'failed',
      errorMessage: 'Provider failed.',
    });
  });
});
