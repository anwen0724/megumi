import { describe, expect, it } from 'vitest';
import {
  ApprovalExpiredEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  ContextPatchRequestedEventSchema,
  RuntimeEventSchema,
  RuntimeEventTypeSchema,
  ToolExecutionDeniedEventSchema,
  ToolExecutionPolicyDecidedEventSchema,
  ToolExecutionRequestedEventSchema,
  isTerminalRuntimeEvent,
  createRuntimeEventSchema,
} from '@megumi/shared/runtime-event-schemas';
import {
  createRuntimeCheckpointCreatedEvent,
  createRuntimeRunCancelRequestedEvent,
  createRuntimeRunRetryRequestedEvent,
  createRuntimeRunResumeRequestedEvent,
  createRuntimeMemoryCandidateProposedEvent,
  createRuntimeMemoryRecallFailedEvent,
  createRuntimeMemoryRecordStatusChangedEvent,
  createRuntimeArtifactCreatedEvent,
  createRuntimeArtifactVersionCreatedEvent,
  createContextPatchRequestedEvent,
  createModelThinkingCompletedEvent,
  createModelThinkingDeltaEvent,
  createModelThinkingStartedEvent,
  createModelStepStartedEvent,
  createModelToolCallDetectedEvent,
  createRunInterruptedEvent,
  createRunWaitingForApprovalEvent,
  createRunStartedEvent,
  createRuntimeEvent,
  createContextCompactionCompletedEvent,
  createContextCompactionFailedEvent,
  createContextCompactionStartedEvent,
  createSessionActiveLeafChangedEvent,
  createSessionBranchDraftCancelledEvent,
  createSessionBranchMarkerCreatedEvent,
  createToolResultCreatedEvent,
  createToolCallCreatedEvent,
  createToolExecutionApprovalRequestedEvent,
  createToolExecutionCompletedEvent,
  createToolExecutionDeniedEvent,
  createToolExecutionFailedEvent,
  createToolExecutionPolicyDecidedEvent,
  createToolExecutionRequestedEvent,
  createToolExecutionStartedEvent,
  createToolExecutionValidatedEvent,
  createWorkspaceRestoreCompletedEvent,
  createWorkspaceRestoreRequestedEvent,
} from '@megumi/shared/runtime-event-factory';
import { RUNTIME_EVENT_TYPES, type RuntimeEvent } from '@megumi/shared/runtime-events';

const runtimeContext = {
  requestId: 'ipc-chat-start-1',
  traceId: 'trace-runtime-1',
  debugId: 'debug-runtime-1',
  operationName: 'session.message.send',
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
    expect(RuntimeEventTypeSchema.parse('tool.execution.completed')).toBe('tool.execution.completed');
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

  it('copies runtime context from runtime request refs when creating run events', () => {
    const event = createRunStartedEvent({
      eventId: 'event-from-factory',
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-05-12T10:00:01.000Z',
      request: {
        requestId: 'ipc-chat-start-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runtimeContext,
      },
    });

    expect(event).toMatchObject({
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      },
    });
  });

  it('accepts context compaction audit events without raw prompt or provider bodies', () => {
    const started = createContextCompactionStartedEvent({
      eventId: 'event-compaction-started',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      requestId: 'request-1',
      sequence: 2,
      createdAt: '2026-05-31T12:00:00.000Z',
      runtimeContext,
      payload: {
        compactionId: 'compaction-1',
        triggerReason: 'context_budget_pressure',
        tokensBefore: 9000,
        firstKeptSourceRef: {
          sourceId: 'session-message:message-3',
          sourceKind: 'session_message',
          sourceUri: 'session-message://message-3',
        },
        summarizedSourceCount: 2,
        previousCompactionId: 'compaction-0',
      },
    });

    const completed = createContextCompactionCompletedEvent({
      eventId: 'event-compaction-completed',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      requestId: 'request-1',
      sequence: 3,
      createdAt: '2026-05-31T12:00:01.000Z',
      runtimeContext,
      payload: {
        compactionId: 'compaction-1',
        triggerReason: 'context_budget_pressure',
        tokensBefore: 9000,
        firstKeptSourceRef: {
          sourceId: 'session-message:message-3',
          sourceKind: 'session_message',
          sourceUri: 'session-message://message-3',
        },
        summarizedSourceCount: 2,
        previousCompactionId: 'compaction-0',
        readFiles: ['packages/context-management/session-compaction.ts'],
        modifiedFiles: ['apps/desktop/src/main/services/session-run.service.ts'],
      },
    });

    const failed = createContextCompactionFailedEvent({
      eventId: 'event-compaction-failed',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      requestId: 'request-1',
      sequence: 4,
      createdAt: '2026-05-31T12:00:02.000Z',
      runtimeContext,
      payload: {
        triggerReason: 'context_budget_pressure',
        tokensBefore: 9000,
        previousCompactionId: 'compaction-0',
        error: {
          code: 'provider_network_error',
          message: 'Summary model call failed before the normal model step.',
          severity: 'error',
          retryable: true,
          source: 'provider',
        },
      },
    });

    expect(RuntimeEventSchema.parse(started)).toEqual(started);
    expect(RuntimeEventSchema.parse(completed)).toEqual(completed);
    expect(RuntimeEventSchema.parse(failed)).toEqual(failed);
    expect(RUNTIME_EVENT_TYPES).toEqual(expect.arrayContaining([
      'context.compaction.started',
      'context.compaction.completed',
      'context.compaction.failed',
    ]));
    expect(JSON.stringify([started, completed, failed])).not.toContain('rawProviderBody');
    expect(JSON.stringify([started, completed, failed])).not.toContain('summaryPrompt');
    expect(JSON.stringify([started, completed, failed])).not.toContain('tool result raw');
  });

  it('validates active path branch audit runtime events', () => {
    const branchCreated = createSessionBranchMarkerCreatedEvent({
      eventId: 'event-branch-created',
      sessionId: 'session-1',
      requestId: 'request-branch-1',
      sequence: 1,
      createdAt: '2026-06-01T08:00:00.000Z',
      payload: {
        branchMarkerId: 'branch-marker-1',
        branchMarkerSourceEntryId: 'source-entry-branch-marker-1',
        previousLeafSourceEntryId: 'source-entry-old-leaf',
        targetLeafSourceEntryId: 'source-entry-parent',
        selectedSourceRef: {
          sourceKind: 'session_message',
          sourceId: 'message-2',
          sourceUri: 'session-message://message-2',
        },
        seedSourceRef: {
          sourceKind: 'session_message',
          sourceId: 'message-2',
          sourceUri: 'session-message://message-2',
        },
        reason: 'branch_from_user_message',
      },
    });
    const activeChanged = createSessionActiveLeafChangedEvent({
      eventId: 'event-active-leaf-changed',
      sessionId: 'session-1',
      requestId: 'request-branch-1',
      sequence: 2,
      createdAt: '2026-06-01T08:00:00.000Z',
      payload: {
        previousLeafSourceEntryId: 'source-entry-old-leaf',
        leafSourceEntryId: 'source-entry-branch-marker-1',
        reason: 'branch_marker',
        sourceRef: {
          sourceKind: 'branch_marker',
          sourceId: 'branch-marker-1',
          sourceUri: 'branch-marker://branch-marker-1',
        },
      },
    });
    const cancelled = createSessionBranchDraftCancelledEvent({
      eventId: 'event-branch-cancelled',
      sessionId: 'session-1',
      requestId: 'request-branch-1',
      sequence: 3,
      createdAt: '2026-06-01T08:00:01.000Z',
      payload: {
        branchMarkerId: 'branch-marker-1',
        branchMarkerSourceEntryId: 'source-entry-branch-marker-1',
        restoredLeafSourceEntryId: 'source-entry-old-leaf',
        reason: 'branch_cancelled',
      },
    });

    expect(RuntimeEventSchema.parse(branchCreated).eventType).toBe('session.branch_marker.created');
    expect(RuntimeEventSchema.parse(activeChanged).eventType).toBe('session.active_leaf.changed');
    expect(RuntimeEventSchema.parse(cancelled).eventType).toBe('session.branch_draft.cancelled');
  });

  it('parses interrupted run audit events', () => {
    const event = RuntimeEventSchema.parse(createRunInterruptedEvent({
      eventId: 'event-interrupted-1',
      runId: 'run_123',
      sessionId: 'session_123',
      sequence: 1,
      createdAt: '2026-06-01T10:00:00.000Z',
      payload: {
        interruptedMarkerId: 'interrupted_marker_123',
        previousStatus: 'running',
        reason: 'app_restarted',
      },
    }));

    expect(event.eventType).toBe('run.interrupted');
    if (event.eventType !== 'run.interrupted') {
      throw new Error('Expected run.interrupted event.');
    }
    expect(event.payload.previousStatus).toBe('running');
  });

  it('parses workspace restore audit events without snapshot raw content', () => {
    const requested = createWorkspaceRestoreRequestedEvent({
      eventId: 'event-workspace-restore-requested',
      runId: 'run-restore-1',
      sessionId: 'session-restore-1',
      requestId: 'restore-request-1',
      sequence: 1,
      createdAt: '2026-06-05T10:00:00.000Z',
      source: 'main',
      payload: {
        restoreRequestId: 'workspace-restore-request-1',
        changeSetId: 'change-set-1',
        requestedBy: 'user',
      },
    });
    const completed = createWorkspaceRestoreCompletedEvent({
      eventId: 'event-workspace-restore-completed',
      runId: 'run-restore-1',
      sessionId: 'session-restore-1',
      requestId: 'restore-request-1',
      sequence: 2,
      createdAt: '2026-06-05T10:00:01.000Z',
      source: 'main',
      payload: {
        restoreRequestId: 'workspace-restore-request-1',
        restoreResultId: 'workspace-restore-result-1',
        changeSetId: 'change-set-1',
        status: 'partial',
        changedFileCount: 3,
        restoredCount: 1,
        conflictCount: 1,
        failedCount: 0,
        noopCount: 1,
      },
    });

    expect(RuntimeEventSchema.parse(requested)).toEqual(requested);
    expect(RuntimeEventSchema.parse(completed)).toEqual(completed);
    expect(requested).toMatchObject({
      eventType: 'workspace.restore.requested',
      visibility: 'system',
      persist: 'required',
    });
    expect(completed).toMatchObject({
      eventType: 'workspace.restore.completed',
      visibility: 'system',
      persist: 'required',
    });
    expect(RUNTIME_EVENT_TYPES).toEqual(expect.arrayContaining([
      'workspace.restore.requested',
      'workspace.restore.completed',
    ]));
    const serialized = JSON.stringify([requested, completed]);
    expect(serialized).not.toContain('before secret');
    expect(serialized).not.toContain('after secret');
    expect(serialized).not.toContain('contentText');
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
        operationName: 'run-context.patch.request',
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

describe('tool and approval runtime events', () => {
  it('accepts requested tool and approval events with full shared objects', () => {
    const base = {
      eventId: 'event-tool-requested',
      schemaVersion: 1 as const,
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-20T00:00:00.000Z',
      source: 'tool' as const,
      visibility: 'user' as const,
      persist: 'required' as const,
    };
    const toolExecution = {
      toolExecutionId: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      toolName: 'read_file',
      input: { path: 'README.md' },
      inputPreview: {
        summary: 'Read README.md',
        targets: [{ kind: 'file' as const, label: 'README.md', sensitivity: 'normal' as const }],
        redactionState: 'none' as const,
      },
      capabilities: ['project_read' as const],
      riskLevel: 'low' as const,
      sideEffect: 'none' as const,
      status: 'pending_approval' as const,
      requestedAt: '2026-05-20T00:00:00.000Z',
    };
    const approvalRequest = {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'edit_file',
      capabilities: ['project_write' as const],
      riskLevel: 'medium' as const,
      title: 'Edit file',
      summary: 'Edit src/app.ts',
      preview: {
        action: 'Edit file',
        targets: [{ kind: 'file' as const, label: 'src/app.ts', sensitivity: 'normal' as const }],
      },
      requestedScope: 'once' as const,
      status: 'pending' as const,
      createdAt: '2026-05-20T00:00:00.000Z',
    };

    const toolExecutionRequestedEvent = {
      ...base,
      eventType: 'tool.execution.requested' as const,
      payload: { toolExecution },
    };
    const approvalRequestedEvent = {
      ...base,
      eventId: 'event-approval-requested',
      eventType: 'approval.requested' as const,
      source: 'approval' as const,
      payload: { approvalRequest },
    };

    expect(ToolExecutionRequestedEventSchema.parse(toolExecutionRequestedEvent).payload.toolExecution.toolExecutionId).toBe('tool-execution-1');
    expect(ApprovalRequestedEventSchema.parse(approvalRequestedEvent).payload.approvalRequest.approvalRequestId).toBe('approval-1');
  });

  it('validates policy decided, denied, and approval expired events', () => {
    const base = {
      eventId: 'event-tool-1',
      schemaVersion: 1 as const,
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      actionId: 'action-1',
      sequence: 1,
      createdAt: '2026-05-16T00:00:00.000Z',
      source: 'security' as const,
      visibility: 'debug' as const,
      persist: 'required' as const,
    };
    const policyDecision = {
      permissionDecisionId: 'permission-decision-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      decision: 'allow' as const,
      source: 'permission_mode' as const,
      reason: 'Read-only project tool.',
      mode: 'default' as const,
      capability: 'project_read' as const,
      sideEffect: 'none' as const,
      effectiveRiskLevel: 'low' as const,
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    };

    expect(ToolExecutionPolicyDecidedEventSchema.parse({
      ...base,
      eventType: 'tool.execution.policy_decided',
      payload: {
        toolExecutionId: 'tool-execution-1',
        toolName: 'read_file',
        policyDecision,
      },
    }).payload.policyDecision.decision).toBe('allow');

    expect(ToolExecutionDeniedEventSchema.parse({
      ...base,
      eventId: 'event-tool-2',
      eventType: 'tool.execution.denied',
      payload: {
        toolExecutionId: 'tool-execution-1',
        reason: 'Plan mode blocks workspace writes.',
      },
    }).payload.reason).toContain('Plan mode');

    expect(ApprovalExpiredEventSchema.parse({
      ...base,
      eventId: 'event-approval-1',
      eventType: 'approval.expired',
      payload: {
        approvalRequestId: 'approval-1',
        toolCallId: 'tool-call-1',
        expiredAt: '2026-05-16T00:01:00.000Z',
      },
    }).payload.approvalRequestId).toBe('approval-1');

    const resolved = ApprovalResolvedEventSchema.parse({
      ...base,
      eventId: 'event-approval-2',
      eventType: 'approval.resolved',
      payload: {
        approvalRequestId: 'approval-1',
        decision: 'approved',
        scope: 'once',
        decidedAt: '2026-05-16T00:01:30.000Z',
      },
    });

    expect(resolved.payload).toMatchObject({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'once',
    });
    expect(resolved.payload).not.toHaveProperty('approvalId');
  });

  it('creates typed tool events through the generic runtime event factory', () => {
    const policyDecision = {
      permissionDecisionId: 'permission-decision-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      decision: 'allow' as const,
      source: 'permission_mode' as const,
      reason: 'Read-only project tool.',
      mode: 'default' as const,
      capability: 'project_read' as const,
      sideEffect: 'none' as const,
      effectiveRiskLevel: 'low' as const,
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    };
    const event = createRuntimeEvent({
      eventId: 'event-tool-3',
      eventType: 'tool.execution.policy_decided',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      actionId: 'action-1',
      sequence: 1,
      createdAt: '2026-05-16T00:00:00.000Z',
      source: 'security',
      visibility: 'debug',
      persist: 'required',
      payload: {
        toolExecutionId: 'tool-execution-1',
        toolName: 'read_file',
        policyDecision,
      },
    });

    expect(RuntimeEventSchema.parse(event).eventType).toBe('tool.execution.policy_decided');
  });

  it('creates tool execution lifecycle events through factory helpers', () => {
    const base = {
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      actionId: 'action-1',
      createdAt: '2026-05-16T00:00:00.000Z',
      source: 'tool' as const,
      visibility: 'debug' as const,
      persist: 'required' as const,
    };
    const policyDecision = {
      permissionDecisionId: 'permission-decision-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      decision: 'allow' as const,
      source: 'permission_mode' as const,
      reason: 'Read-only project tool.',
      mode: 'default' as const,
      capability: 'project_read' as const,
      sideEffect: 'none' as const,
      effectiveRiskLevel: 'low' as const,
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    };
    const approvalRequest = {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'edit_file',
      capabilities: ['project_write' as const],
      riskLevel: 'medium' as const,
      title: 'Edit file',
      summary: 'Edit src/app.ts',
      preview: {
        action: 'Edit file',
        targets: [{ kind: 'file' as const, label: 'src/app.ts', sensitivity: 'normal' as const }],
      },
      requestedScope: 'once' as const,
      status: 'pending' as const,
      createdAt: '2026-05-16T00:00:00.000Z',
    };
    const toolExecution = {
      toolExecutionId: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      input: { path: 'README.md' },
      inputPreview: {
        summary: 'Read README.md',
        targets: [{ kind: 'file' as const, label: 'README.md', sensitivity: 'normal' as const }],
        redactionState: 'none' as const,
      },
      capabilities: ['project_read' as const],
      riskLevel: 'low' as const,
      sideEffect: 'none' as const,
      status: 'pending_approval' as const,
      requestedAt: '2026-05-16T00:00:00.000Z',
    };

    const events = [
      createToolExecutionRequestedEvent({
        ...base,
        eventId: 'event-tool-execution-requested',
        eventType: 'tool.execution.requested',
        sequence: 1,
        payload: { toolExecution },
      }),
      createToolExecutionValidatedEvent({
        ...base,
        eventId: 'event-tool-execution-validated',
        eventType: 'tool.execution.validated',
        sequence: 2,
        payload: { toolExecutionId: 'tool-execution-1', toolName: 'read_file' },
      }),
      createToolExecutionPolicyDecidedEvent({
        ...base,
        eventId: 'event-tool-execution-policy-decided',
        eventType: 'tool.execution.policy_decided',
        sequence: 3,
        source: 'security',
        payload: { toolExecutionId: 'tool-execution-1', toolName: 'read_file', policyDecision },
      }),
      createToolExecutionApprovalRequestedEvent({
        ...base,
        eventId: 'event-tool-execution-approval-requested',
        eventType: 'tool.execution.approval_requested',
        sequence: 4,
        source: 'approval',
        visibility: 'user',
        payload: { toolExecutionId: 'tool-execution-1', toolName: 'edit_file', approvalRequest },
      }),
      createToolExecutionStartedEvent({
        ...base,
        eventId: 'event-tool-execution-started',
        eventType: 'tool.execution.started',
        sequence: 5,
        payload: { toolExecutionId: 'tool-execution-1', startedAt: '2026-05-16T00:00:01.000Z' },
      }),
      createToolExecutionCompletedEvent({
        ...base,
        eventId: 'event-tool-execution-completed',
        eventType: 'tool.execution.completed',
        sequence: 6,
        payload: { toolExecutionId: 'tool-execution-1', completedAt: '2026-05-16T00:00:02.000Z' },
      }),
      createToolExecutionFailedEvent({
        ...base,
        eventId: 'event-tool-execution-failed',
        eventType: 'tool.execution.failed',
        sequence: 7,
        payload: {
          toolExecutionId: 'tool-execution-1',
          error: {
            code: 'runtime_unknown',
            message: 'Tool execution failed.',
            severity: 'error',
            retryable: false,
            source: 'tool',
          },
          completedAt: '2026-05-16T00:00:02.000Z',
        },
      }),
      createToolExecutionDeniedEvent({
        ...base,
        eventId: 'event-tool-execution-denied',
        eventType: 'tool.execution.denied',
        sequence: 8,
        payload: { toolExecutionId: 'tool-execution-1', reason: 'Denied by policy.' },
      }),
    ];

    expect(events.map((event) => RuntimeEventSchema.parse(event).eventType)).toEqual([
      'tool.execution.requested',
      'tool.execution.validated',
      'tool.execution.policy_decided',
      'tool.execution.approval_requested',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.execution.failed',
      'tool.execution.denied',
    ]);
  });
});

describe('agent recovery runtime events', () => {
  it('creates and parses recovery runtime events', () => {
    const base = {
      eventId: 'event_123',
      runId: 'run_123',
      source: 'core' as const,
      sequence: 1,
      createdAt: '2026-05-16T10:00:00.000Z',
    };

    expect(
      RuntimeEventSchema.parse(
        createRuntimeCheckpointCreatedEvent(base, {
          checkpointId: 'checkpoint_123',
          reason: 'before_approval_wait',
          boundary: 'approval_boundary',
          stateSummary: 'Waiting for approval.',
        }),
      ).eventType,
    ).toBe('checkpoint.created');

    expect(
      RuntimeEventSchema.parse(
        createRuntimeRunResumeRequestedEvent(base, {
          resumeRequestId: 'resume_request_123',
          requestedBy: 'user',
          reason: 'manual_resume',
          resumeMode: 'from_checkpoint',
          checkpointId: 'checkpoint_123',
        }),
      ).eventType,
    ).toBe('run.resume.requested');

    expect(
      RuntimeEventSchema.parse(
        createRuntimeRunCancelRequestedEvent(base, {
          cancelRequestId: 'cancel_request_123',
          requestedBy: 'user',
          reason: 'user_requested',
          scope: 'run',
        }),
      ).eventType,
    ).toBe('run.cancel.requested');

    expect(
      RuntimeEventSchema.parse(
        createRuntimeRunRetryRequestedEvent(base, {
          retryRequestId: 'retry_request_123',
          requestedBy: 'runtime',
          retryKind: 'retry_action',
          reason: 'runtime_error',
          checkpointId: 'checkpoint_123',
        }),
      ).eventType,
    ).toBe('run.retry.requested');
  });
});

describe('artifact runtime events', () => {
  it('accepts artifact lifecycle events with eventType and safe payload refs', () => {
    const created = RuntimeEventSchema.parse({
      eventId: 'event-artifact-created',
      schemaVersion: 1,
      eventType: 'artifact.created',
      runId: 'run:artifact',
      stepId: 'step:artifact',
      sequence: 1,
      createdAt: '2026-05-16T00:00:00.000Z',
      source: 'artifact',
      visibility: 'user',
      persist: 'required',
      payload: {
        artifactId: 'artifact:1',
        artifactVersionId: 'artifact-version:1',
        kind: 'report',
        title: 'Architecture report',
        status: 'draft',
      },
    });

    const version = RuntimeEventSchema.parse({
      eventId: 'event-artifact-version',
      schemaVersion: 1,
      eventType: 'artifact.version.created',
      runId: 'run:artifact',
      sequence: 2,
      createdAt: '2026-05-16T00:00:01.000Z',
      source: 'artifact',
      visibility: 'system',
      persist: 'required',
      payload: {
        artifactId: 'artifact:1',
        artifactVersionId: 'artifact-version:2',
        versionNumber: 2,
        contentType: 'markdown',
        textPreview: 'Updated summary',
      },
    });

    expect(created.eventType).toBe('artifact.created');
    expect(version.payload).not.toHaveProperty('inlineText');
  });

  it('accepts artifact status changed referenced and content write failed events', () => {
    expect(RuntimeEventSchema.parse({
      eventId: 'event-artifact-status',
      schemaVersion: 1,
      eventType: 'artifact.status.changed',
      runId: 'run:artifact',
      sequence: 1,
      createdAt: '2026-05-16T00:00:00.000Z',
      source: 'artifact',
      visibility: 'system',
      persist: 'required',
      payload: {
        artifactId: 'artifact:1',
        from: 'draft',
        to: 'active',
      },
    })).toMatchObject({ payload: { to: 'active' } });

    expect(RuntimeEventSchema.parse({
      eventId: 'event-artifact-ref',
      schemaVersion: 1,
      eventType: 'artifact.referenced',
      runId: 'run:artifact',
      sequence: 2,
      createdAt: '2026-05-16T00:00:01.000Z',
      source: 'artifact',
      visibility: 'system',
      persist: 'required',
      payload: {
        artifactId: 'artifact:1',
        artifactVersionId: 'artifact-version:1',
        referencedByKind: 'run',
        referencedById: 'run:next',
      },
    })).toMatchObject({ payload: { referencedByKind: 'run' } });

    expect(RuntimeEventSchema.parse({
      eventId: 'event-artifact-write-failed',
      schemaVersion: 1,
      eventType: 'artifact.content.write.failed',
      runId: 'run:artifact',
      sequence: 3,
      createdAt: '2026-05-16T00:00:02.000Z',
      source: 'artifact',
      visibility: 'system',
      persist: 'required',
      payload: {
        artifactId: 'artifact:1',
        artifactVersionId: 'artifact-version:1',
        storage: 'megumi_home',
        error: {
          code: 'artifact_write_failed',
          message: 'Artifact content write failed.',
          severity: 'error',
          retryable: true,
          source: 'filesystem',
        },
      },
    })).toMatchObject({ payload: { error: expect.not.objectContaining({ recoverable: expect.anything() }) } });
  });

  it('creates artifact events through factory helpers', () => {
    const base = {
      eventId: 'event-artifact-factory',
      runId: 'run:artifact',
      source: 'core' as const,
      sequence: 1,
      createdAt: '2026-05-16T00:00:00.000Z',
    };

    expect(createRuntimeArtifactCreatedEvent(base, {
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      kind: 'report',
      title: 'Report',
      status: 'draft',
    }).eventType).toBe('artifact.created');

    expect(createRuntimeArtifactVersionCreatedEvent({
      ...base,
      eventId: 'event-artifact-version-factory',
    }, {
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:2',
      versionNumber: 2,
      contentType: 'markdown',
      textPreview: 'Preview only',
    }).payload).not.toHaveProperty('inlineText');
  });
});

describe('memory runtime events', () => {
  it('registers 08 memory event types and no longer relies on memory.created', () => {
    expect(RUNTIME_EVENT_TYPES).toContain('memory.candidate.proposed');
    expect(RUNTIME_EVENT_TYPES).toContain('memory.record.status.changed');
    expect(RUNTIME_EVENT_TYPES).toContain('memory.recall.failed');
    expect(RUNTIME_EVENT_TYPES).not.toContain('memory.created');
  });

  it('parses memory events using eventType and safe payload refs', () => {
    const event = createRuntimeMemoryCandidateProposedEvent(
      {
        eventId: 'event:memory-candidate',
        runId: 'run:1',
        sessionId: 'session:1',
        sequence: 1,
        createdAt: '2026-05-16T00:00:00.000Z',
        source: 'memory',
      },
      {
        candidateId: 'memory-candidate:1',
        scope: 'workspace',
        kind: 'workflow',
        status: 'proposed',
        riskLevel: 'low',
        summary: '使用 spec -> brief -> plans 流程。',
        sourceRefCount: 1,
      },
    );

    expect(RuntimeEventSchema.parse(event).eventType).toBe('memory.candidate.proposed');
    expect(event).not.toHaveProperty('type');
    expect(JSON.stringify(event)).not.toContain('raw full prompt');
  });

  it('parses status change and failed recall events with RuntimeError severity and retryable', () => {
    expect(
      RuntimeEventSchema.parse(
        createRuntimeMemoryRecordStatusChangedEvent(
          {
            eventId: 'event:memory-status',
            runId: 'run:1',
            sequence: 2,
            createdAt: '2026-05-16T00:00:01.000Z',
            source: 'memory',
          },
          {
            memoryId: 'memory:1',
            from: 'active',
            to: 'disabled',
            reason: 'User disabled memory.',
          },
        ),
      ).eventType,
    ).toBe('memory.record.status.changed');

    const failed = RuntimeEventSchema.parse(
      createRuntimeMemoryRecallFailedEvent(
        {
          eventId: 'event:memory-recall-failed',
          runId: 'run:1',
          sequence: 3,
          createdAt: '2026-05-16T00:00:02.000Z',
          source: 'memory',
        },
        {
          recallRequestId: 'memory-recall:1',
          error: {
            code: 'runtime_unknown',
            message: 'Memory recall failed.',
            severity: 'error',
            retryable: true,
            source: 'memory',
            debugId: 'debug:memory-recall',
          },
        },
      ),
    );

    expect(failed.eventType).toBe('memory.recall.failed');
    expect(JSON.stringify(failed)).not.toContain('recoverable');
  });
});

describe('05 tool call and execution runtime events', () => {
  it('does not expose action-centered tool or approval events as the v1 tool path', () => {
    expect(RUNTIME_EVENT_TYPES).not.toContain('action.requested');
    expect(RUNTIME_EVENT_TYPES).toContain('model.tool_call.detected');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.call.created');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.execution.requested');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.execution.validated');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.execution.policy_decided');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.execution.approval_requested');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.execution.started');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.execution.completed');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.execution.failed');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.execution.denied');
    expect(RUNTIME_EVENT_TYPES).toContain('permission.decision.created');
    expect(RUNTIME_EVENT_TYPES).toContain('tool.result.created');
    expect(RUNTIME_EVENT_TYPES).toContain('approval.requested');
    expect(RUNTIME_EVENT_TYPES).toContain('approval.resolved');
  });

  it('accepts model step and tool-call events', () => {
    expect(RuntimeEventSchema.parse({
      eventId: 'event-model-step-started',
      schemaVersion: 1,
      eventType: 'model.step.started',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-20T00:00:00.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelStepId: 'model-step-1',
        providerId: 'openai-compatible',
        modelId: 'gpt-5.2',
      },
    }).eventType).toBe('model.step.started');

    expect(RuntimeEventSchema.parse({
      eventId: 'event-tool-call-created',
      schemaVersion: 1,
      eventType: 'tool.call.created',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 2,
      createdAt: '2026-05-20T00:00:01.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolCallId: 'tool-call-1',
        modelStepId: 'model-step-1',
        providerToolCallId: 'call-provider-1',
        toolName: 'read_file',
        input: { path: 'package.json' },
      },
    }).payload).toMatchObject({
      toolCallId: 'tool-call-1',
      input: { path: 'package.json' },
    });
  });

  it('accepts model output, detected tool call, and completed model step events', () => {
    expect(RuntimeEventSchema.parse({
      eventId: 'event-model-output-delta',
      schemaVersion: 1,
      eventType: 'model.output.delta',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-20T00:00:00.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'transient',
      payload: {
        modelStepId: 'model-step-1',
        delta: 'Reading project files',
      },
    }).eventType).toBe('model.output.delta');

    expect(RuntimeEventSchema.parse({
      eventId: 'event-model-tool-call-detected',
      schemaVersion: 1,
      eventType: 'model.tool_call.detected',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 2,
      createdAt: '2026-05-20T00:00:01.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelStepId: 'model-step-1',
        toolCallId: 'tool-call-1',
        providerToolCallId: 'call-provider-1',
        toolName: 'read_file',
      },
    }).payload).toMatchObject({
      toolCallId: 'tool-call-1',
      providerToolCallId: 'call-provider-1',
    });

    expect(RuntimeEventSchema.parse({
      eventId: 'event-model-provider-state-recorded',
      schemaVersion: 1,
      eventType: 'model.step.provider_state.recorded',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 3,
      createdAt: '2026-05-20T00:00:01.500Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelStepId: 'model-step-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        blocks: [
          {
            type: 'reasoning_content',
            text: 'I need to inspect docs.',
          },
        ],
      },
    }).payload).toMatchObject({
      modelStepId: 'model-step-1',
      blocks: [
        {
          type: 'reasoning_content',
        },
      ],
    });

    expect(RuntimeEventSchema.parse({
      eventId: 'event-model-step-completed',
      schemaVersion: 1,
      eventType: 'model.step.completed',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 4,
      createdAt: '2026-05-20T00:00:02.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelStepId: 'model-step-1',
        finishReason: 'tool_call',
      },
    }).payload).toEqual({
      modelStepId: 'model-step-1',
      finishReason: 'tool_call',
    });
  });

  it('rejects extra payload fields on model step completed events', () => {
    expect(() => RuntimeEventSchema.parse({
      eventId: 'event-model-step-completed-extra',
      schemaVersion: 1,
      eventType: 'model.step.completed',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 4,
      createdAt: '2026-05-20T00:00:03.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelStepId: 'model-step-1',
        finishReason: 'stop',
        rawProviderBody: { secret: 'sk-test' },
      },
    })).toThrow();
  });

  it('rejects extra payload fields on tool-call created events', () => {
    expect(() => RuntimeEventSchema.parse({
      eventId: 'event-tool-call-created-extra',
      schemaVersion: 1,
      eventType: 'tool.call.created',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 4,
      createdAt: '2026-05-20T00:00:03.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolCallId: 'tool-call-1',
        modelStepId: 'model-step-1',
        providerToolCallId: 'call-provider-1',
        toolName: 'read_file',
        input: { path: 'package.json' },
        rawProviderBody: { secret: 'sk-test' },
      },
    })).toThrow();
  });

  it('accepts tool result and run waiting events', () => {
    expect(RuntimeEventSchema.parse({
      eventId: 'event-tool-result-created',
      schemaVersion: 1,
      eventType: 'tool.result.created',
      runId: 'run-1',
      sequence: 3,
      createdAt: '2026-05-20T00:00:02.000Z',
      source: 'tool',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolResultId: 'tool-result-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        kind: 'success',
        summary: 'Read file.',
      },
    }).payload).toMatchObject({ kind: 'success' });

    expect(RuntimeEventSchema.parse({
      eventId: 'event-run-waiting',
      schemaVersion: 1,
      eventType: 'run.waiting_for_approval',
      runId: 'run-1',
      sequence: 4,
      createdAt: '2026-05-20T00:00:03.000Z',
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        approvalRequestId: 'approval-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        reason: 'write_file requires approval.',
      },
    }).eventType).toBe('run.waiting_for_approval');
  });

  it('creates run waiting-for-approval events through the factory and schema', () => {
    const event = createRunWaitingForApprovalEvent({
      eventId: 'event-run-waiting-factory',
      eventType: 'run.waiting_for_approval',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-approval-1',
      sequence: 5,
      createdAt: '2026-05-20T00:00:04.000Z',
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        approvalRequestId: 'approval-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        reason: 'write_file requires approval.',
      },
    });

    expect(RuntimeEventSchema.parse(event)).toEqual(event);
  });

  it('creates model step, tool-call, and tool-result events through factories and schemas', () => {
    const modelStepStarted = createModelStepStartedEvent({
      eventId: 'event-model-step-started-factory',
      eventType: 'model.step.started',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-model-1',
      sequence: 6,
      createdAt: '2026-05-20T00:00:05.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelStepId: 'model-step-1',
        providerId: 'openai-compatible',
        modelId: 'gpt-5.2',
      },
    });

    expect(RuntimeEventSchema.parse(modelStepStarted)).toEqual(modelStepStarted);

    const toolCallCreated = createToolCallCreatedEvent({
      eventId: 'event-tool-call-created-factory',
      eventType: 'tool.call.created',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-model-1',
      sequence: 7,
      createdAt: '2026-05-20T00:00:06.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolCallId: 'tool-call-1',
        modelStepId: 'model-step-1',
        providerToolCallId: 'call-provider-1',
        toolName: 'read_file',
        input: { path: 'package.json' },
      },
    });

    expect(RuntimeEventSchema.parse(toolCallCreated)).toEqual(toolCallCreated);

    const toolResultCreated = createToolResultCreatedEvent({
      eventId: 'event-tool-result-created-factory',
      eventType: 'tool.result.created',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-tool-1',
      sequence: 8,
      createdAt: '2026-05-20T00:00:07.000Z',
      source: 'tool',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolResultId: 'tool-result-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        kind: 'success',
        summary: 'Read file.',
      },
    });

    expect(RuntimeEventSchema.parse(toolResultCreated)).toEqual(toolResultCreated);
  });

  it('accepts live model thinking events and creates them through factories', () => {
    const started = createModelThinkingStartedEvent({
      eventId: 'event-model-thinking-started',
      eventType: 'model.thinking.started',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-24T00:00:00.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'transient',
      payload: {
        modelStepId: 'model-step-1',
      },
    });
    const delta = createModelThinkingDeltaEvent({
      eventId: 'event-model-thinking-delta',
      eventType: 'model.thinking.delta',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      sequence: 2,
      createdAt: '2026-05-24T00:00:00.100Z',
      source: 'provider',
      visibility: 'system',
      persist: 'transient',
      payload: {
        modelStepId: 'model-step-1',
        delta: 'I need to inspect the project.',
      },
    });
    const completed = createModelThinkingCompletedEvent({
      eventId: 'event-model-thinking-completed',
      eventType: 'model.thinking.completed',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      sequence: 3,
      createdAt: '2026-05-24T00:00:00.200Z',
      source: 'provider',
      visibility: 'system',
      persist: 'transient',
      payload: {
        modelStepId: 'model-step-1',
      },
    });

    expect(RuntimeEventSchema.parse(started)).toEqual(started);
    expect(RuntimeEventSchema.parse(delta)).toEqual(delta);
    expect(RuntimeEventSchema.parse(completed)).toEqual(completed);
    expect(RUNTIME_EVENT_TYPES).toEqual(expect.arrayContaining([
      'model.thinking.started',
      'model.thinking.delta',
      'model.thinking.completed',
    ]));
  });

  it('creates model tool-call detected events through the factory helper', () => {
    const event = createModelToolCallDetectedEvent({
      eventId: 'event-model-tool-call-detected-factory',
      eventType: 'model.tool_call.detected',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      sequence: 4,
      createdAt: '2026-05-24T00:00:01.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelStepId: 'model-step-1',
        toolCallId: 'tool-call-1',
        providerToolCallId: 'call-read',
        toolName: 'read_file',
      },
    });

    expect(RuntimeEventSchema.parse(event)).toEqual(event);
    expect(event.payload.toolName).toBe('read_file');
  });
});
