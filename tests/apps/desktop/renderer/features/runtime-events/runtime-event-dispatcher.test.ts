// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApprovalStore } from '@megumi/desktop/renderer/entities/approval';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useToolCallStore } from '@megumi/desktop/renderer/entities/tool-call';
import { dispatchRuntimeEvent } from '@megumi/desktop/renderer/features/runtime-events/runtime-event-dispatcher';
import { useRuntimeTimelineStore } from '@megumi/desktop/renderer/features/runtime-timeline';
import type { RuntimeEvent } from '@megumi/coding-agent/events';

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
    createdAt: `2026-05-17T00:00:${sequence.toString().padStart(2, '0')}.000Z`,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
    ...overrides,
  } as RuntimeEvent;
}

describe('runtime event dispatcher', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useChatUiStore.setState({
      activeSessionId: null,
      agentStatus: 'idle',
      lastError: null,
      sessionStates: {},
    });
    useRunStore.getState().resetRuns();
    useRuntimeTimelineStore.getState().reset();
    useToolCallStore.getState().reset();
    useApprovalStore.getState().reset();
    useSessionStore.setState({
      sessions: [],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores text deltas for run state and chat UI state', () => {
    dispatchRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    dispatchRuntimeEvent(runtimeEvent('model.output.delta', 2, { modelStepId: 'model-step-1', delta: 'Docs ' }, {
      source: 'provider',
    }));
    dispatchRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: 'answer.' }));
    dispatchRuntimeEvent(runtimeEvent('context.effective.updated', 4, { sourceCount: 1 }));
    dispatchRuntimeEvent(runtimeEvent('model.step.completed', 5, { modelStepId: 'model-step-1', finishReason: 'stop' }, {
      source: 'provider',
    }));

    expect(useRunStore.getState().eventsByRun['run-1'].map((event) => event.eventType)).toEqual([
      'run.started',
      'context.effective.updated',
      'model.step.completed',
    ]);
    expect(useChatUiStore.getState()).toMatchObject({
      agentStatus: 'running',
      lastError: null,
    });
  });

  it('projects terminal run status and errors without synthesizing assistant messages', () => {
    dispatchRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }));
    dispatchRuntimeEvent(runtimeEvent('assistant.output.completed', 2, { content: 'Final answer.' }));
    dispatchRuntimeEvent(runtimeEvent('run.completed', 3));

    expect(useRunStore.getState().runs['run-1']).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      status: 'completed',
      updatedAt: '2026-05-17T00:00:03.000Z',
    });
    expect(useChatUiStore.getState()).toMatchObject({
      agentStatus: 'idle',
      lastError: null,
    });

    dispatchRuntimeEvent(runtimeEvent('run.failed', 4, {
      error: {
        code: 'provider_disabled',
        message: 'Provider is disabled.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    }, { runId: 'run-2', sessionId: 'session-1' }));

    expect(useChatUiStore.getState()).toMatchObject({
      agentStatus: 'error',
      lastError: 'Provider is disabled.',
    });
  });

  it('stores inactive session UI status without projecting it to the active session', () => {
    useSessionStore.setState({
      sessions: [],
      activeSessionId: 'session-2',
      activeAgentType: 'free',
    });

    dispatchRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'chat' }, { sessionId: 'session-1' }));

    expect(useRunStore.getState().runs['run-1']).toMatchObject({
      status: 'running',
      sessionId: 'session-1',
    });
    expect(useChatUiStore.getState()).toMatchObject({
      agentStatus: 'idle',
      lastError: null,
      sessionStates: {
        'session-1': expect.objectContaining({
          agentStatus: 'running',
          lastError: null,
        }),
      },
    });
  });

  it('ignores events without run ids for run and chat UI state', () => {
    dispatchRuntimeEvent(runtimeEvent('run.started', 1, {}, { runId: undefined }));

    expect(useRunStore.getState()).toMatchObject({
      activeRunId: null,
      runs: {},
      eventsByRun: {},
    });
    expect(useChatUiStore.getState().agentStatus).toBe('idle');
  });

  it('projects tool call events into the renderer tool-call store', () => {
    dispatchRuntimeEvent(runtimeEvent('tool_call.requested', 1, {
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      input: { path: 'README.md' },
    }));
    dispatchRuntimeEvent(runtimeEvent('tool_call.started', 2, {
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'read_file',
      input: { path: 'README.md' },
    }));

    expect(useToolCallStore.getState().toolCallsById['tool-execution-1']).toMatchObject({
      toolCallId: 'tool-call-1',
      status: 'running',
      startedAt: '2026-05-17T00:00:02.000Z',
    });
    expect(useChatUiStore.getState().agentStatus).toBe('running');
  });

  it('stores denied tool calls from tool result events', () => {
    dispatchRuntimeEvent(runtimeEvent('tool_call.started', 1, {
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'edit_file',
      input: { path: 'src/app.ts' },
    }));
    dispatchRuntimeEvent(runtimeEvent('tool_result.created', 2, {
      toolResultId: 'tool-result-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'edit_file',
      kind: 'user_rejected',
      summary: 'User denied the requested tool call.',
    }));

    const storedToolCall = useToolCallStore.getState().toolCallsById['tool-execution-1'];
    expect(storedToolCall).toMatchObject({
      status: 'rejected',
      resultPreview: 'User denied the requested tool call.',
    });
  });

  it('projects approval events and waiting status into renderer stores', () => {
    dispatchRuntimeEvent(runtimeEvent('approval.requested', 1, {
      approvalRequest: {
        approvalRequestId: 'approval-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
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
    expect(useChatUiStore.getState().agentStatus).toBe('running');
  });

  it('does not project duplicate tool events twice', () => {
    const requested = runtimeEvent('tool_call.requested', 1, {
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      input: { path: 'README.md' },
    });
    const started = runtimeEvent('tool_call.started', 2, {
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      toolName: 'read_file',
      input: { path: 'README.md' },
    });
    const duplicateStartedWithDifferentCreatedAt = {
      ...started,
      createdAt: '2026-05-20T00:00:09.000Z',
      payload: {
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        toolName: 'read_file',
        input: { path: 'README.md' },
      },
    } as RuntimeEvent;

    dispatchRuntimeEvent(requested);
    dispatchRuntimeEvent(requested);
    dispatchRuntimeEvent(started);
    dispatchRuntimeEvent(duplicateStartedWithDifferentCreatedAt);

    expect(useToolCallStore.getState().toolCallsById['tool-execution-1']).toMatchObject({
      status: 'running',
      startedAt: '2026-05-17T00:00:02.000Z',
    });
  });

  it('does not drop different runtime events that share a sequence', () => {
    dispatchRuntimeEvent(runtimeEvent('run.started', 1, { runKind: 'agent' }));
    dispatchRuntimeEvent(runtimeEvent('model_call.text_delta', 2, {
      modelCallId: 'model-call-1',
      delta: 'Hello ',
    }, { eventId: 'event-text-1' }));
    dispatchRuntimeEvent(runtimeEvent('model_call.text_delta', 2, {
      modelCallId: 'model-call-1',
      delta: 'world',
    }, { eventId: 'event-text-2' }));

    const runtimeSession = useRuntimeTimelineStore.getState().sessions['runtime:session-1'];
    const assistant = runtimeSession?.messages.find((message) => message.role === 'assistant');
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');

    expect(useRunStore.getState().eventsByRun['run-1'].map((event) => event.eventId)).toEqual([
      'event-1',
      'event-text-1',
      'event-text-2',
    ]);
    expect(answer).toMatchObject({
      kind: 'answer_text',
      text: 'Hello world',
    });
  });
});

describe('useRunStore', () => {
  beforeEach(() => {
    useRunStore.getState().resetRuns();
  });

  it('deduplicates events by event id only and sorts by sequence', () => {
    const store = useRunStore.getState();

    store.applyRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: 'late' }));
    store.applyRuntimeEvent(runtimeEvent('run.started', 1, {}, { eventId: 'same-event' }));
    store.applyRuntimeEvent(runtimeEvent('run.started', 2, {}, { eventId: 'same-event' }));
    store.applyRuntimeEvent(runtimeEvent('assistant.output.delta', 3, { delta: 'duplicate sequence' }, { eventId: 'different-event' }));

    expect(useRunStore.getState().eventsByRun['run-1'].map((event) => event.eventId)).toEqual([
      'same-event',
      'event-3',
      'different-event',
    ]);
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

