import { describe, expect, it } from 'vitest';
import {
  ApprovalExpiredEventSchema,
  ApprovalResolvedEventSchema,
  ContextPatchRequestedEventSchema,
  RuntimeEventSchema,
  RuntimeEventTypeSchema,
  ToolCallDeniedEventSchema,
  ToolCallPolicyDecidedEventSchema,
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
  createRunStartedEvent,
  createRuntimeEvent,
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

    expect(ToolCallPolicyDecidedEventSchema.parse({
      ...base,
      eventType: 'tool.call.policy_decided',
      payload: {
        toolCallId: 'tool-call-1',
        toolName: 'workspace_read_file',
        decision: 'allow',
        effectiveRiskLevel: 'low',
        reason: 'Read-only workspace tool.',
      },
    }).payload.decision).toBe('allow');

    expect(ToolCallDeniedEventSchema.parse({
      ...base,
      eventId: 'event-tool-2',
      eventType: 'tool.call.denied',
      payload: {
        toolCallId: 'tool-call-1',
        toolName: 'workspace_write_file',
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
    const event = createRuntimeEvent({
      eventId: 'event-tool-3',
      eventType: 'tool.call.policy_decided',
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
        toolCallId: 'tool-call-1',
        toolName: 'workspace_read_file',
        decision: 'allow',
        effectiveRiskLevel: 'low',
        reason: 'Read-only workspace tool.',
      },
    });

    expect(RuntimeEventSchema.parse(event).eventType).toBe('tool.call.policy_decided');
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

describe('05 tool-use runtime events', () => {
  it('accepts model step and tool-use events', () => {
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
      eventId: 'event-tool-use-created',
      schemaVersion: 1,
      eventType: 'tool.use.created',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 2,
      createdAt: '2026-05-20T00:00:01.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolUseId: 'tool-use-1',
        modelStepId: 'model-step-1',
        providerToolUseId: 'call-provider-1',
        toolName: 'read_file',
      },
    }).payload).toMatchObject({ toolUseId: 'tool-use-1' });
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
        toolUseId: 'tool-use-1',
        toolCallId: 'tool-call-1',
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
        toolUseId: 'tool-use-1',
        toolCallId: 'tool-call-1',
        reason: 'write_file requires approval.',
      },
    }).eventType).toBe('run.waiting_for_approval');
  });
});
