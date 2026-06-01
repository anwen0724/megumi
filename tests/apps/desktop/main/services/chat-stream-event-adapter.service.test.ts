// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createChatStreamEventAdapter,
  type ChatStreamEventSink,
} from '@megumi/desktop/main/services/chat-stream-event-adapter.service';
import { ChatStreamEventSchema, type ChatStreamEvent } from '@megumi/shared';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

function collectSink(): { sink: ChatStreamEventSink; events: ChatStreamEvent[] } {
  const events: ChatStreamEvent[] = [];
  return {
    events,
    sink: {
      publish: (event) => {
        events.push(ChatStreamEventSchema.parse(event));
      },
    },
  };
}

function adapter(events: ChatStreamEvent[]) {
  return createChatStreamEventAdapter({
    sink: { publish: (event) => events.push(ChatStreamEventSchema.parse(event)) },
    projectId: 'project-1',
    sessionId: 'session-1',
    runId: 'run-1',
    streamId: 'stream-main-1',
    streamKind: 'main',
    userMessageId: 'message-user-1',
    clientMessageId: 'message-local-user',
    userMessageText: 'Hello',
    createdAt: '2026-05-24T00:00:00.000Z',
    now: () => '2026-05-24T00:00:00.050Z',
    ids: {
      eventId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `chat-stream-event-${index}`;
        };
      })(),
      textId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `text-${index}`;
        };
      })(),
      thinkingId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `thinking-${index}`;
        };
      })(),
    },
  });
}

function runtimeEvent(event: Partial<RuntimeEvent> & Pick<RuntimeEvent, 'eventType' | 'payload' | 'sequence'>): RuntimeEvent {
  return {
    eventId: `runtime-event-${event.sequence}`,
    schemaVersion: 1,
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    createdAt: '2026-05-24T00:00:00.000Z',
    ...event,
  } as RuntimeEvent;
}

describe('createChatStreamEventAdapter', () => {
  it('publishes turn and user message events on start', () => {
    const { events } = collectSink();
    const subject = adapter(events);

    subject.startTurn();

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2]);
    expect(events[0].streamId).toBe('stream-main-1');
    expect(events[0].streamId).not.toBe(events[0].runId);
  });

  it('maps branch and runtime process facts into canonical chat stream events without raw backend details', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();

    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'session.branch_marker.created',
      sequence: 1,
      createdAt: '2026-06-01T10:00:00.000Z',
      payload: {
        branchMarkerId: 'branch-marker-1',
        branchMarkerSourceEntryId: 'source-entry-branch-marker-1',
        seedSourceRef: {
          sourceKind: 'session_message',
          sourceId: 'message-seed-1',
          sourceUri: 'session-message://message-seed-1',
          loadedAt: '2026-06-01T09:58:00.000Z',
        },
        selectedSourceRef: {
          sourceKind: 'session_message',
          sourceId: 'message-seed-1',
          sourceUri: 'session-message://message-seed-1',
          loadedAt: '2026-06-01T09:58:00.000Z',
        },
        reason: 'branch_from_user_message',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'context.compaction.completed',
      sequence: 2,
      payload: {
        compactionId: 'compaction-1',
        triggerReason: 'token_budget',
        tokensBefore: 12000,
        firstKeptSourceRef: {
          sourceKind: 'session_message',
          sourceId: 'message-kept-1',
          sourceUri: 'session-message://message-kept-1',
          loadedAt: '2026-06-01T10:00:00.000Z',
        },
        summarizedSourceCount: 3,
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'run.retry.requested',
      sequence: 3,
      payload: {
        retryRequestId: 'retry-attempt-1',
        requestedBy: 'user',
        retryKind: 'manual_rerun',
        reason: 'user_requested',
        metadata: {
          rawProviderBody: 'secret provider body',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'run.interrupted',
      sequence: 4,
      payload: {
        interruptedMarkerId: 'interrupted-marker-1',
        previousStatus: 'running',
        reason: 'app_restarted',
        stack: 'secret stack',
      },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'branch.separator.created',
      'process.compaction.recorded',
      'process.retry.recorded',
      'process.recovery.recorded',
    ]);
    expect(events[2]).toMatchObject({
      eventType: 'branch.separator.created',
      branchMarkerId: 'branch-marker-1',
      sourceMessageId: 'message-seed-1',
      label: 'Branch from 10:00',
    });
    expect(events[3]).toMatchObject({
      eventType: 'process.compaction.recorded',
      compactionId: 'compaction-1',
      status: 'completed',
      label: 'Compacted context',
    });
    expect(events[4]).toMatchObject({
      eventType: 'process.retry.recorded',
      retryAttemptId: 'retry-attempt-1',
      attemptNumber: 1,
      status: 'started',
      label: 'Retry attempt 1 started',
      reason: 'user_requested',
    });
    expect(events[5]).toMatchObject({
      eventType: 'process.recovery.recorded',
      status: 'interrupted',
      label: 'Previous run was interrupted',
    });
    expect(JSON.stringify(events)).not.toContain('secret provider body');
    expect(JSON.stringify(events)).not.toContain('secret stack');
    expect(JSON.stringify(events)).not.toContain('source-entry-branch-marker-1');
  });

  it('buffers tool-enabled pure text until run completion confirms final answer phase', () => {
    vi.useFakeTimers();
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();

    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 1,
      payload: { modelStepId: 'model-step-1', delta: 'Hel' },
    }));
    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
    ]);

    vi.advanceTimersByTime(50);
    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
    ]);

    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 2,
      payload: { modelStepId: 'model-step-1', delta: 'lo' },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'run.completed',
      sequence: 3,
      payload: {},
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.delta',
      'assistant.text.completed',
      'turn.completed',
    ]);
    expect(events.filter((event) => event.eventType === 'assistant.text.delta').map((event) => event.phase)).toEqual([
      'answer',
      'answer',
    ]);
    vi.useRealTimers();
  });

  it('moves buffered text to prelude when tool use is detected before phase gate flush', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 1,
      payload: { modelStepId: 'model-step-1', delta: 'Let me check.' },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.tool_call.detected',
      sequence: 2,
      payload: {
        modelStepId: 'model-step-1',
        providerToolCallId: 'tool-use-1',
        toolName: 'read_file',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.call.created',
      sequence: 3,
      payload: {
        modelStepId: 'model-step-1',
        toolCallId: 'tool-call-1',
        providerToolCallId: 'tool-use-1',
        toolName: 'read_file',
        input: { path: 'README.md' },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.step.completed',
      sequence: 4,
      payload: { modelStepId: 'model-step-1', finishReason: 'tool_calls' },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'tool.started',
      'assistant.text.completed',
    ]);
    expect(events[3]).toMatchObject({ eventType: 'assistant.text.delta', phase: 'prelude' });
  });

  it('keeps prelude text open for later same-step deltas until tool-call step completion', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 1,
      payload: { modelStepId: 'model-step-1', delta: "I'll " },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.tool_call.detected',
      sequence: 2,
      payload: {
        modelStepId: 'model-step-1',
        providerToolCallId: 'tool-use-1',
        toolName: 'read_file',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 3,
      payload: { modelStepId: 'model-step-1', delta: 'check that.' },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.step.completed',
      sequence: 4,
      payload: { modelStepId: 'model-step-1', finishReason: 'tool_calls' },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.delta',
      'assistant.text.completed',
    ]);
    expect(events.filter((event) => event.eventType === 'assistant.text.delta')).toEqual([
      expect.objectContaining({ phase: 'prelude', delta: "I'll " }),
      expect.objectContaining({ phase: 'prelude', delta: 'check that.' }),
    ]);
    expect(events.map((event) => event.eventType)).not.toContain('turn.failed');
  });

  it('does not let elapsed phase timing classify a later tool-use step as answer', () => {
    vi.useFakeTimers();
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 1,
      payload: { modelStepId: 'model-step-1', delta: 'First step prelude.' },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.tool_call.detected',
      sequence: 2,
      payload: {
        modelStepId: 'model-step-1',
        providerToolCallId: 'tool-use-1',
        toolName: 'read_file',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.step.completed',
      sequence: 3,
      payload: { modelStepId: 'model-step-1', finishReason: 'tool_calls' },
    }));

    vi.advanceTimersByTime(49);
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 4,
      payload: { modelStepId: 'model-step-2', delta: 'Second step prelude.' },
    }));
    vi.advanceTimersByTime(1);
    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
    ]);
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.tool_call.detected',
      sequence: 5,
      payload: {
        modelStepId: 'model-step-2',
        providerToolCallId: 'tool-use-2',
        toolName: 'search_text',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.step.completed',
      sequence: 6,
      payload: { modelStepId: 'model-step-2', finishReason: 'tool_calls' },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
    ]);
    expect(events.filter((event) => event.eventType === 'assistant.text.delta').map((event) => event.phase)).toEqual([
      'prelude',
      'prelude',
    ]);
    expect(events.map((event) => event.eventType)).not.toContain('turn.failed');
    vi.useRealTimers();
  });

  it('completes open prelude text when a tool-call model step completes', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.tool_call.detected',
      sequence: 1,
      payload: {
        modelStepId: 'model-step-1',
        providerToolCallId: 'tool-use-1',
        toolName: 'read_file',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 2,
      payload: { modelStepId: 'model-step-1', delta: 'I will inspect the file.' },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.step.completed',
      sequence: 3,
      payload: { modelStepId: 'model-step-1', finishReason: 'tool_calls' },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
    ]);
    expect(events.filter((event) => event.eventType.startsWith('assistant.text.'))).toEqual([
      expect.objectContaining({ eventType: 'assistant.text.started', phase: 'prelude' }),
      expect.objectContaining({ eventType: 'assistant.text.delta', phase: 'prelude' }),
      expect.objectContaining({ eventType: 'assistant.text.completed', phase: 'prelude' }),
    ]);
  });

  it('maps thinking runtime events to assistant thinking events', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.thinking.started',
      sequence: 1,
      payload: { modelStepId: 'model-step-1' },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.thinking.delta',
      sequence: 2,
      payload: { modelStepId: 'model-step-1', delta: 'I need context.' },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.thinking.completed',
      sequence: 3,
      payload: { modelStepId: 'model-step-1' },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.thinking.started',
      'assistant.thinking.delta',
      'assistant.thinking.completed',
    ]);
  });

  it('maps tool result and approval events to chat stream activities', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.call.created',
      sequence: 1,
      payload: {
        modelStepId: 'model-step-1',
        toolCallId: 'tool-call-1',
        providerToolCallId: 'tool-use-1',
        toolName: 'write_file',
        input: { path: 'src/app.ts' },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'approval.requested',
      sequence: 2,
      payload: {
        approvalRequest: {
          approvalRequestId: 'approval-request-1',
          toolCallId: 'tool-call-1',

          toolExecutionId: 'tool-execution-1',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'write_file',
          capabilities: ['project_write'],
          riskLevel: 'medium',
          title: 'Approve write_file',
          summary: 'Writing project file requires approval.',
          preview: { action: 'write_file', targets: [] },
          requestedScope: 'project',
          status: 'pending',
          createdAt: '2026-05-24T00:00:01.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'approval.resolved',
      sequence: 3,
      payload: {
        approvalRequestId: 'approval-request-1',
        decision: 'approved',
        scope: 'project',
        decidedAt: '2026-05-24T00:00:02.000Z',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.result.created',
      sequence: 4,
      payload: {
        toolResultId: 'tool-result-1',
        toolCallId: 'tool-call-1',

        toolExecutionId: 'tool-execution-1',
        kind: 'success',
        summary: 'Wrote src/app.ts',
      },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'tool.started',
      'approval.requested',
      'approval.resolved',
      'tool.completed',
    ]);
  });

  it('maps tool call terminal runtime facts to chat stream activities', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.call.created',
      sequence: 1,
      payload: {
        modelStepId: 'model-step-1',
        toolCallId: 'tool-call-completed',
        providerToolCallId: 'tool-use-completed',
        toolName: 'read_file',
        input: { path: 'README.md' },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.requested',
      sequence: 2,
      payload: {
        toolExecution: {
          toolCallId: 'tool-call-completed',

          toolExecutionId: 'tool-execution-completed',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'read_file',
          input: { path: 'README.md' },
          inputPreview: {
            summary: 'Read README.md',
            targets: [],
            redactionState: 'none',
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          status: 'running',
          requestedAt: '2026-05-24T00:00:01.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.completed',
      sequence: 3,
      payload: {
        toolCallId: 'tool-call-completed',

        toolExecutionId: 'tool-execution-completed',
        completedAt: '2026-05-24T00:00:02.000Z',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.requested',
      sequence: 4,
      payload: {
        toolExecution: {
          toolCallId: 'tool-call-failed',

          toolExecutionId: 'tool-execution-failed',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'run_command',
          input: { command: 'npm test' },
          inputPreview: {
            summary: 'npm test',
            targets: [],
            redactionState: 'none',
          },
          capabilities: ['command_run'],
          riskLevel: 'high',
          sideEffect: 'runs_command',
          status: 'running',
          requestedAt: '2026-05-24T00:00:03.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.failed',
      sequence: 5,
      payload: {
        toolCallId: 'tool-call-failed',

        toolExecutionId: 'tool-execution-failed',
        error: {
          code: 'runtime_unknown',
          message: 'Command failed.',
          severity: 'error',
          retryable: false,
          source: 'tool',
        },
        completedAt: '2026-05-24T00:00:04.000Z',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.requested',
      sequence: 6,
      payload: {
        toolExecution: {
          toolCallId: 'tool-call-denied',

          toolExecutionId: 'tool-execution-denied',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'write_file',
          input: { path: 'src/app.ts' },
          inputPreview: {
            summary: 'Write src/app.ts',
            targets: [],
            redactionState: 'none',
          },
          capabilities: ['project_write'],
          riskLevel: 'medium',
          sideEffect: 'writes_project',
          status: 'running',
          requestedAt: '2026-05-24T00:00:05.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.denied',
      sequence: 7,
      payload: {
        toolCallId: 'tool-call-denied',

        toolExecutionId: 'tool-execution-denied',
        reason: 'Plan mode blocks writes.',
      },
    }));
    subject.dispose();

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'tool.started',
      'tool.completed',
      'tool.failed',
      'tool.denied',
    ]);
    expect(events.at(-3)).toMatchObject({
      eventType: 'tool.completed',
      toolCallId: 'tool-call-completed',

      toolExecutionId: 'tool-execution-completed',
      toolName: 'read_file',
    });
    expect(events.at(-2)).toMatchObject({
      eventType: 'tool.failed',
      toolCallId: 'tool-call-failed',

      toolExecutionId: 'tool-execution-failed',
      toolName: 'run_command',
      errorCode: 'runtime_unknown',
      errorMessage: 'Command failed.',
    });
    expect(events.at(-1)).toMatchObject({
      eventType: 'tool.denied',
      toolCallId: 'tool-call-denied',

      toolExecutionId: 'tool-execution-denied',
      toolName: 'write_file',
      reason: 'Plan mode blocks writes.',
    });
  });

  it('collapses call and result terminal facts into one tool lifecycle terminal event', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.call.created',
      sequence: 1,
      payload: {
        modelStepId: 'model-step-1',
        toolCallId: 'tool-call-success',
        providerToolCallId: 'tool-use-success',
        toolName: 'read_file',
        input: { path: 'README.md' },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.requested',
      sequence: 2,
      payload: {
        toolExecution: {
          toolCallId: 'tool-call-success',

          toolExecutionId: 'tool-execution-success',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'read_file',
          input: { path: 'README.md' },
          inputPreview: {
            summary: 'Read README.md',
            targets: [],
            redactionState: 'none',
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          status: 'running',
          requestedAt: '2026-05-24T00:00:01.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.completed',
      sequence: 3,
      payload: {
        toolCallId: 'tool-call-success',

        toolExecutionId: 'tool-execution-success',
        completedAt: '2026-05-24T00:00:02.000Z',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.result.created',
      sequence: 4,
      payload: {
        toolResultId: 'tool-result-success',
        toolCallId: 'tool-call-success',

        toolExecutionId: 'tool-execution-success',
        kind: 'success',
        summary: 'Read README.md',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.requested',
      sequence: 5,
      payload: {
        toolExecution: {
          toolCallId: 'tool-call-failed',

          toolExecutionId: 'tool-execution-failed',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'run_command',
          input: { command: 'npm test' },
          inputPreview: {
            summary: 'npm test',
            targets: [],
            redactionState: 'none',
          },
          capabilities: ['command_run'],
          riskLevel: 'high',
          sideEffect: 'runs_command',
          status: 'running',
          requestedAt: '2026-05-24T00:00:03.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.failed',
      sequence: 6,
      payload: {
        toolCallId: 'tool-call-failed',

        toolExecutionId: 'tool-execution-failed',
        error: {
          code: 'runtime_unknown',
          message: 'Command failed.',
          severity: 'error',
          retryable: false,
          source: 'tool',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.result.created',
      sequence: 7,
      payload: {
        toolResultId: 'tool-result-failed',
        toolCallId: 'tool-call-failed',

        toolExecutionId: 'tool-execution-failed',
        kind: 'tool_error',
        summary: 'Command failed.',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.requested',
      sequence: 8,
      payload: {
        toolExecution: {
          toolCallId: 'tool-call-denied',

          toolExecutionId: 'tool-execution-denied',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'write_file',
          input: { path: 'src/app.ts' },
          inputPreview: {
            summary: 'Write src/app.ts',
            targets: [],
            redactionState: 'none',
          },
          capabilities: ['project_write'],
          riskLevel: 'medium',
          sideEffect: 'writes_project',
          status: 'running',
          requestedAt: '2026-05-24T00:00:04.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.execution.denied',
      sequence: 9,
      payload: {
        toolCallId: 'tool-call-denied',

        toolExecutionId: 'tool-execution-denied',
        reason: 'Plan mode blocks writes.',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'tool.result.created',
      sequence: 10,
      payload: {
        toolResultId: 'tool-result-denied',
        toolCallId: 'tool-call-denied',

        toolExecutionId: 'tool-execution-denied',
        kind: 'policy_denied',
        summary: 'Plan mode blocks writes.',
      },
    }));

    expect(events.filter((event) => event.eventType === 'tool.completed')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'tool.failed')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'tool.denied')).toHaveLength(1);
    expect(events.find((event) => event.eventType === 'tool.completed')).toMatchObject({
      toolResultId: 'tool-result-success',
      resultSummary: 'Read README.md',
    });
    expect(events.find((event) => event.eventType === 'tool.failed')).toMatchObject({
      toolResultId: 'tool-result-failed',
      resultSummary: 'Command failed.',
      errorMessage: 'Command failed.',
    });
    expect(events.find((event) => event.eventType === 'tool.denied')).toMatchObject({
      toolResultId: 'tool-result-denied',
      reason: 'Plan mode blocks writes.',
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'tool.started',
      'tool.completed',
      'tool.failed',
      'tool.denied',
    ]);
  });

  it('preserves approval linkage when resolved runtime event only has approval id', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'approval.requested',
      sequence: 1,
      payload: {
        approvalRequest: {
          approvalRequestId: 'approval-request-1',
          toolCallId: 'tool-call-1',

          toolExecutionId: 'tool-execution-1',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'write_file',
          capabilities: ['project_write'],
          riskLevel: 'medium',
          title: 'Approve write_file',
          summary: 'Writing project file requires approval.',
          preview: { action: 'write_file', targets: [] },
          requestedScope: 'project',
          status: 'pending',
          createdAt: '2026-05-24T00:00:01.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'approval.resolved',
      sequence: 2,
      payload: {
        approvalRequestId: 'approval-request-1',
        decision: 'denied',
        scope: 'project',
        decidedAt: '2026-05-24T00:00:02.000Z',
      },
    }));

    expect(events.at(-1)).toMatchObject({
      eventType: 'approval.resolved',
      approvalId: 'approval-request-1',
      toolCallId: 'tool-call-1',

      toolExecutionId: 'tool-execution-1',
      status: 'rejected',
      decision: 'rejected',
    });
  });

  it('maps approval expired to resolved with remembered tool linkage and scope', () => {
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'approval.requested',
      sequence: 1,
      payload: {
        approvalRequest: {
          approvalRequestId: 'approval-request-1',
          toolCallId: 'tool-call-1',

          toolExecutionId: 'tool-execution-1',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'write_file',
          capabilities: ['project_write'],
          riskLevel: 'medium',
          title: 'Approve write_file',
          summary: 'Writing project file requires approval.',
          preview: { action: 'write_file', targets: [] },
          requestedScope: 'local',
          status: 'pending',
          createdAt: '2026-05-24T00:00:01.000Z',
        },
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'approval.expired',
      sequence: 2,
      payload: {
        approvalRequestId: 'approval-request-1',
        toolCallId: 'tool-call-1',

        toolExecutionId: 'tool-execution-1',
        expiredAt: '2026-05-24T00:05:01.000Z',
      },
    }));

    expect(events.at(-1)).toMatchObject({
      eventType: 'approval.resolved',
      approvalId: 'approval-request-1',
      toolCallId: 'tool-call-1',

      toolExecutionId: 'tool-execution-1',
      scope: 'local',
      status: 'expired',
      decision: 'expired',
    });
  });

  it('terminates partial answer before turn failed', () => {
    vi.useFakeTimers();
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 1,
      payload: { modelStepId: 'model-step-1', delta: 'Partial answer' },
    }));
    vi.advanceTimersByTime(50);
    subject.flushPhaseGate();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'run.failed',
      sequence: 2,
      payload: {
        error: {
          code: 'provider_network_error',
          message: 'Provider failed.',
          severity: 'error',
          source: 'provider',
        },
      },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.failed',
      'turn.failed',
    ]);
    expect(events.at(-2)).toMatchObject({
      eventType: 'assistant.text.failed',
      phase: 'answer',
      errorCode: 'provider_network_error',
    });
    vi.useRealTimers();
  });

  it('terminates partial answer before turn cancelled', () => {
    vi.useFakeTimers();
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 1,
      payload: { modelStepId: 'model-step-1', delta: 'Partial answer' },
    }));
    vi.advanceTimersByTime(50);
    subject.flushPhaseGate();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'run.cancelled',
      sequence: 2,
      payload: { reason: 'User cancelled.' },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.cancelled_partial',
      'turn.cancelled',
    ]);
    expect(events.at(-2)).toMatchObject({
      eventType: 'assistant.text.cancelled_partial',
      phase: 'answer',
      reason: 'User cancelled.',
    });
    vi.useRealTimers();
  });

  it('moves elapsed buffered text to prelude when a late tool-use signal arrives in the same model step', () => {
    vi.useFakeTimers();
    const events: ChatStreamEvent[] = [];
    const subject = adapter(events);
    subject.startTurn();
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.output.delta',
      sequence: 1,
      payload: { modelStepId: 'model-step-1', delta: 'This is final.' },
    }));
    vi.advanceTimersByTime(50);
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.tool_call.detected',
      sequence: 2,
      payload: {
        modelStepId: 'model-step-1',
        providerToolCallId: 'tool-use-late',
        toolName: 'read_file',
      },
    }));
    subject.handleRuntimeEvent(runtimeEvent({
      eventType: 'model.step.completed',
      sequence: 3,
      payload: { modelStepId: 'model-step-1', finishReason: 'tool_calls' },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
    ]);
    expect(events[3]).toMatchObject({ eventType: 'assistant.text.delta', phase: 'prelude' });
    expect(events.map((event) => event.eventType)).not.toContain('turn.failed');
    vi.useRealTimers();
  });
});
