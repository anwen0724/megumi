import { describe, expect, it, vi } from 'vitest';
import {
  attachRunPermissionSnapshot,
  cancelAgentLoopModelStep,
  completeAgentLoopModelStep,
  failAgentLoopBeforeModelStep,
  failAgentLoopModelStep,
  runTurn,
  startAgentLoopRun,
} from '@megumi/coding-agent/state';
import { createRunCreatedEvent } from '@megumi/coding-agent/events';
import type { RunLifecycleSink } from '@megumi/coding-agent/state';
import type { RuntimeEvent } from '@megumi/shared/runtime';

function createSink() {
  const events: RuntimeEvent[] = [];
  const sink: RunLifecycleSink = {
    saveRun: vi.fn(),
    saveStep: vi.fn(),
    saveAction: vi.fn(),
    saveObservation: vi.fn(),
    appendEvent: vi.fn((event: RuntimeEvent) => {
      events.push(event);
    }),
  };

  return { sink, events };
}

const ids = {
  runId: () => 'run-1',
  stepId: () => 'step-1',
  actionId: () => 'action-1',
  observationId: () => 'observation-1',
  checkpointId: () => 'checkpoint-1',
  resumeRequestId: () => 'resume-request-1',
  cancelRequestId: () => 'cancel-request-1',
  retryRequestId: () => 'retry-request-1',
  debugId: () => 'debug-agent-1',
  eventId: vi.fn()
    .mockReturnValueOnce('event-1')
    .mockReturnValueOnce('event-2')
    .mockReturnValueOnce('event-3')
    .mockReturnValueOnce('event-4')
    .mockReturnValueOnce('event-5')
    .mockReturnValueOnce('event-6')
    .mockReturnValueOnce('event-7')
    .mockReturnValueOnce('event-8')
    .mockReturnValueOnce('event-9')
    .mockReturnValueOnce('event-10')
    .mockReturnValueOnce('event-11'),
  messageId: () => 'message-1',
};

function createEventIds(eventIds: string[]) {
  let index = 0;
  return {
    eventId: () => eventIds[index++] ?? `event-extra-${index}`,
  };
}

describe('run runtime lifecycle events', () => {
  it('starts an agent loop run with its initial model step through the state owner', () => {
    const { sink } = createSink();

    const result = startAgentLoopRun({
      runId: 'run-1',
      stepId: 'step-1',
      sessionId: 'session-1',
      triggerMessageId: 'message-1',
      mode: 'default',
      goal: 'Answer the user',
      permissionSnapshotRef: 'permission-snapshot-1',
      createdAt: '2026-05-15T00:00:00.000Z',
      lifecycle: sink,
    });

    expect(result.run).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      triggerMessageId: 'message-1',
      mode: 'default',
      goal: 'Answer the user',
      status: 'running',
      permissionSnapshotRef: 'permission-snapshot-1',
      createdAt: '2026-05-15T00:00:00.000Z',
      startedAt: '2026-05-15T00:00:00.000Z',
    });
    expect(result.step).toMatchObject({
      stepId: 'step-1',
      runId: 'run-1',
      kind: 'model',
      status: 'running',
      title: 'Model response',
      startedAt: '2026-05-15T00:00:00.000Z',
    });
    expect(sink.saveRun).toHaveBeenCalledWith(result.run);
    expect(sink.saveStep).toHaveBeenCalledWith(result.step);
  });

  it('attaches a permission snapshot ref to an already started run through the state owner', () => {
    const { sink } = createSink();
    const run = {
      runId: 'run-1',
      sessionId: 'session-1',
      triggerMessageId: 'message-1',
      mode: 'default',
      goal: 'Answer the user',
      status: 'running',
      createdAt: '2026-05-15T00:00:00.000Z',
      startedAt: '2026-05-15T00:00:00.000Z',
    } as const;

    const updated = attachRunPermissionSnapshot({
      run,
      permissionSnapshotRef: 'permission-snapshot-1',
      lifecycle: sink,
    });

    expect(updated).toEqual({
      ...run,
      permissionSnapshotRef: 'permission-snapshot-1',
    });
    expect(sink.saveRun).toHaveBeenCalledWith(updated);
  });

  it('fails an agent loop run before the first model step through the state owner', () => {
    const { sink } = createSink();

    const result = failAgentLoopBeforeModelStep({
      requestId: 'request-1',
      sessionId: 'session-1',
      run: {
        runId: 'run-1',
        sessionId: 'session-1',
        triggerMessageId: 'message-1',
        mode: 'default',
        goal: 'Answer',
        status: 'running',
        createdAt: '2026-05-15T00:00:00.000Z',
        startedAt: '2026-05-15T00:00:00.000Z',
      },
      step: {
        stepId: 'step-1',
        runId: 'run-1',
        kind: 'model',
        status: 'running',
        title: 'Model response',
        startedAt: '2026-05-15T00:00:00.000Z',
      },
      error: {
        code: 'runtime_unknown',
        message: 'Context failed',
        severity: 'error',
        retryable: false,
        source: 'core',
      },
      startSequence: 4,
      failedAt: '2026-05-15T00:00:01.000Z',
      runtimeContext: {
        source: 'core',
        requestId: 'request-1',
        operationName: 'session.message.send',
        createdAt: '2026-05-15T00:00:01.000Z',
        traceId: 'trace-1',
      },
      ids,
      lifecycle: sink,
    });

    expect(result.run.status).toBe('failed');
    expect(result.step.status).toBe('failed');
    expect(sink.saveRun).toHaveBeenCalledWith(result.run);
    expect(sink.saveStep).toHaveBeenCalledWith(result.step);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(result.events.map((event) => event.sequence)).toEqual([5, 6, 7, 8]);
    expect(result.events[0]).toMatchObject({
      requestId: 'request-1',
      context: { traceId: 'trace-1' },
    });
  });

  it('completes an agent loop model step through the state owner', () => {
    const { sink } = createSink();

    const result = completeAgentLoopModelStep({
      requestId: 'request-1',
      sessionId: 'session-1',
      run: {
        runId: 'run-1',
        sessionId: 'session-1',
        triggerMessageId: 'message-1',
        mode: 'default',
        goal: 'Answer',
        status: 'running',
        createdAt: '2026-05-15T00:00:00.000Z',
        startedAt: '2026-05-15T00:00:00.000Z',
      },
      step: {
        stepId: 'step-1',
        runId: 'run-1',
        kind: 'model',
        status: 'running',
        title: 'Model response',
        startedAt: '2026-05-15T00:00:00.000Z',
      },
      startSequence: 8,
      finishedAt: '2026-05-15T00:00:02.000Z',
      ids: createEventIds(['event-9', 'event-10', 'event-11', 'event-12']),
      lifecycle: sink,
    });

    expect(result.run.status).toBe('completed');
    expect(result.step.status).toBe('succeeded');
    expect(sink.saveStep).toHaveBeenCalledWith(result.step);
    expect(sink.saveRun).toHaveBeenCalledWith(result.run);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(result.events.map((event) => event.sequence)).toEqual([9, 10, 11, 12]);
    expect(result.events[3]).toMatchObject({ requestId: 'request-1' });
  });

  it('fails an agent loop model step through the state owner', () => {
    const { sink } = createSink();
    const error = {
      code: 'runtime_unknown',
      message: 'Provider failed',
      severity: 'error',
      retryable: false,
      source: 'provider',
    } as const;

    const result = failAgentLoopModelStep({
      requestId: 'request-1',
      sessionId: 'session-1',
      run: {
        runId: 'run-1',
        sessionId: 'session-1',
        triggerMessageId: 'message-1',
        mode: 'default',
        goal: 'Answer',
        status: 'running',
        createdAt: '2026-05-15T00:00:00.000Z',
        startedAt: '2026-05-15T00:00:00.000Z',
      },
      step: {
        stepId: 'step-1',
        runId: 'run-1',
        kind: 'model',
        status: 'running',
        title: 'Model response',
        startedAt: '2026-05-15T00:00:00.000Z',
      },
      error,
      startSequence: 12,
      finishedAt: '2026-05-15T00:00:03.000Z',
      ids: createEventIds(['event-13', 'event-14', 'event-15']),
      lifecycle: sink,
    });

    expect(result.run.status).toBe('failed');
    expect(result.step.status).toBe('failed');
    expect(result.run.error).toBe(error);
    expect(result.step.error).toBe(error);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(result.events.map((event) => event.sequence)).toEqual([13, 14, 15]);
  });

  it('cancels an agent loop model step through the state owner', () => {
    const { sink } = createSink();

    const result = cancelAgentLoopModelStep({
      requestId: 'request-1',
      sessionId: 'session-1',
      run: {
        runId: 'run-1',
        sessionId: 'session-1',
        triggerMessageId: 'message-1',
        mode: 'default',
        goal: 'Answer',
        status: 'running',
        createdAt: '2026-05-15T00:00:00.000Z',
        startedAt: '2026-05-15T00:00:00.000Z',
      },
      step: {
        stepId: 'step-1',
        runId: 'run-1',
        kind: 'model',
        status: 'running',
        title: 'Model response',
        startedAt: '2026-05-15T00:00:00.000Z',
      },
      startSequence: 15,
      finishedAt: '2026-05-15T00:00:04.000Z',
      ids: createEventIds(['event-16', 'event-17']),
      lifecycle: sink,
    });

    expect(result.run.status).toBe('cancelled');
    expect(result.step.status).toBe('cancelled');
    expect(result.run.cancelledAt).toBe('2026-05-15T00:00:04.000Z');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'step.status.changed',
      'run.status.changed',
    ]);
    expect(result.events.map((event) => event.sequence)).toEqual([16, 17]);
  });

  it('creates run.created events with stable lifecycle payloads', () => {
    expect(createRunCreatedEvent({
      eventId: 'event-1',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-05-15T00:00:00.000Z',
      mode: 'default',
      goal: 'Answer',
      triggerMessageId: 'message-1',
    })).toMatchObject({
      eventType: 'run.created',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        status: 'queued',
        mode: 'default',
        goal: 'Answer',
        triggerMessageId: 'message-1',
      },
    });
  });

  it('runs the minimal Action -> Host -> Observation loop and persists lifecycle facts', async () => {
    const { sink, events } = createSink();

    const result = await runTurn({
      sessionId: 'session-1',
      triggerMessageId: 'message-1',
      permissionMode: 'default',
      goal: 'Answer the user',
      lifecycle: sink,
      hostBoundary: {
        handleAction: (action) => ({
          observationId: 'observation-1',
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'runtime',
          kind: 'message_emitted',
          receivedAt: '2026-05-15T00:00:00.000Z',
          summary: 'Message emitted',
        }),
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids,
    });

    expect(result.run.status).toBe('completed');
    expect(result.run.metadata).toEqual({
      permissionMode: 'default',
    });
    expect(result.step.status).toBe('succeeded');
    expect(result.step).toMatchObject({
      kind: 'model',
      status: 'succeeded',
      title: 'Model response',
    });
    expect(result.action.kind).toBe('emit_message');
    expect(result.observation.kind).toBe('message_emitted');
    expect(events.map((event) => event.eventType)).toEqual([
      'run.created',
      'run.status.changed',
      'run.started',
      'step.created',
      'step.status.changed',
      'action.requested',
      'observation.received',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(sink.saveRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(sink.saveStep).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'model',
      status: 'succeeded',
      title: 'Model response',
    }));
    expect(sink.saveAction).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(sink.saveObservation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'message_emitted' }));
  });

  it('creates a model step as the default run step foundation', async () => {
    const { sink } = createSink();

    const result = await runTurn({
      sessionId: 'session-1',
      triggerMessageId: 'message-1',
      permissionMode: 'default',
      goal: 'Answer the user',
      lifecycle: sink,
      hostBoundary: {
        handleAction: (action) => ({
          observationId: 'observation-1',
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'runtime',
          kind: 'message_emitted',
          receivedAt: '2026-05-15T00:00:00.000Z',
          summary: 'Message emitted',
        }),
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids,
    });

    expect(result.step).toMatchObject({
      stepId: 'step-1',
      runId: 'run-1',
      kind: 'model',
      status: 'succeeded',
      title: 'Model response',
    });
    expect(result.action.kind).toBe('emit_message');
  });

  it('normalizes host boundary failures into failed run state and run.failed event', async () => {
    const { sink, events } = createSink();

    const result = await runTurn({
      sessionId: 'session-1',
      permissionMode: 'default',
      goal: 'Fail safely',
      lifecycle: sink,
      hostBoundary: {
        handleAction: () => {
          throw new Error('boom secret sk-test-1234567890abcdef');
        },
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      },
    });

    expect(result.run.status).toBe('failed');
    expect(events.map((event) => event.eventType)).toContain('step.status.changed');
    expect(events.map((event) => event.eventType)).toContain('step.failed');
    expect(events.map((event) => event.eventType)).toContain('run.status.changed');
    expect(events.at(-1)?.eventType).toBe('run.failed');
    expect(events.find((event) =>
      event.eventType === 'run.status.changed' &&
      (event.payload as { to?: string }).to === 'failed',
    )?.payload).toMatchObject({
      from: 'running',
      to: 'failed',
    });
    expect(events.at(-1)?.payload).toMatchObject({
      error: {
        debugId: 'debug-agent-1',
        source: 'core',
      },
    });
    expect(JSON.stringify(events)).not.toContain('sk-test-1234567890abcdef');
  });

  it('emits context patch events around update_context actions', async () => {
    const { sink, events } = createSink();

    const result = await runTurn({
      sessionId: 'session-1',
      permissionMode: 'default',
      goal: 'Use workspace context',
      actionKind: 'update_context',
      contextPatch: {
        patchId: 'patch-1',
        runId: 'run-1',
        requestedBy: 'agent',
        operation: 'add',
        sourceRef: 'source-1',
        reason: 'Need shared context contracts.',
        createdAt: '2026-05-15T00:00:00.000Z',
        status: 'requested',
      },
      lifecycle: sink,
      hostBoundary: {
        handleAction: (action) => ({
          observationId: 'observation-1',
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'workspace',
          kind: 'context_patch_applied',
          receivedAt: '2026-05-15T00:00:00.000Z',
          summary: 'Context patch add applied.',
          metadata: {
            patchId: 'patch-1',
            operation: 'add',
            requestedBy: 'agent',
            effectiveContextBuildId: 'build-1',
          },
        }),
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: vi.fn()
          .mockReturnValueOnce('event-1')
          .mockReturnValueOnce('event-2')
          .mockReturnValueOnce('event-3')
          .mockReturnValueOnce('event-4')
          .mockReturnValueOnce('event-5')
          .mockReturnValueOnce('event-6')
          .mockReturnValueOnce('event-7')
          .mockReturnValueOnce('event-8')
          .mockReturnValueOnce('event-9')
          .mockReturnValueOnce('event-10')
          .mockReturnValueOnce('event-11')
          .mockReturnValueOnce('event-12')
          .mockReturnValueOnce('event-13')
          .mockReturnValueOnce('event-14'),
      },
    });

    expect(result.action.kind).toBe('update_context');
    expect(events.map((event) => event.eventType)).toContain('context.patch.requested');
    expect(events.map((event) => event.eventType)).toContain('context.patch.applied');
    expect(events.map((event) => event.eventType)).toContain('context.effective.updated');
    expect(JSON.stringify(events)).not.toContain('raw full prompt');
  });

  it('persists permission snapshot refs and source plan ids on the run', async () => {
    const { sink } = createSink();

    const result = await runTurn({
      sessionId: 'session-1',
      permissionMode: 'default',
      permissionSnapshotRef: 'permission-snapshot:default',
      permissionModeState: {
        permissionMode: 'default',
        source: 'user',
      },
      sourcePlanId: 'plan:accepted',
      goal: 'Execute accepted plan',
      lifecycle: sink,
      hostBoundary: {
        handleAction: (action) => ({
          observationId: 'observation-1',
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'runtime',
          kind: 'message_emitted',
          receivedAt: '2026-05-15T00:00:00.000Z',
          summary: 'Message emitted',
        }),
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      },
    });

    expect(result.run.mode).toBe('default');
    expect(result.run.permissionSnapshotRef).toBe('permission-snapshot:default');
    expect(result.run.sourcePlanId).toBe('plan:accepted');
    expect(result.run.metadata).toEqual({
      permissionMode: 'default',
    });
  });

  it('keeps plan permission mode as an emit_message run by default', async () => {
    const { sink } = createSink();

    const result = await runTurn({
      sessionId: 'session-1',
      permissionMode: 'plan',
      permissionSnapshotRef: 'permission-snapshot:plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'user',
      },
      goal: 'Write a plan',
      lifecycle: sink,
      hostBoundary: {
        handleAction: (action) => ({
          observationId: 'observation-1',
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'runtime',
          kind: 'message_emitted',
          receivedAt: '2026-05-15T00:00:00.000Z',
          summary: 'Message emitted.',
        }),
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      },
    });

    expect(result.run.mode).toBe('plan');
    expect(result.action.kind).toBe('emit_message');
    expect(result.action.inputPreview).toEqual({
      permissionMode: 'plan',
    });
  });

  it('uses resolved permission mode state consistently for run.created events', async () => {
    const { sink, events } = createSink();

    const result = await runTurn({
      sessionId: 'session-1',
      permissionMode: 'default',
      permissionSnapshotRef: 'permission-snapshot:plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      goal: 'Review the project',
      lifecycle: sink,
      hostBoundary: {
        handleAction: (action) => ({
          observationId: 'observation-1',
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'runtime',
          kind: 'message_emitted',
          receivedAt: '2026-05-15T00:00:00.000Z',
          summary: 'Message emitted',
        }),
      },
      clock: { now: () => '2026-05-15T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      },
    });

    expect(result.run.mode).toBe('plan');
    expect(events.find((event) => event.eventType === 'run.created')?.payload).toMatchObject({
      mode: 'plan',
    });
  });

  it('emits checkpoint observation and event for save_checkpoint action', async () => {
    const { sink, events } = createSink();

    const result = await runTurn({
      sessionId: 'session-1',
      permissionMode: 'default',
      goal: 'Save recovery state',
      actionKind: 'save_checkpoint',
      actionInput: {
        reason: 'manual',
        boundary: 'run_boundary',
        stateSummary: 'Manual checkpoint.',
      },
      lifecycle: sink,
      hostBoundary: {
        handleAction: () => {
          throw new Error('host boundary should not handle checkpoints');
        },
      },
      clock: { now: () => '2026-05-16T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      },
    });

    expect(result.observations).toContainEqual(
      expect.objectContaining({
        source: 'checkpoint',
        kind: 'checkpoint_created',
        summary: 'Manual checkpoint.',
      }),
    );
    expect(events.map((event) => event.eventType)).toContain('checkpoint.created');
  });

  it('emits cancel request event for cancel action without executing tools', async () => {
    const { sink, events } = createSink();
    const handleAction = vi.fn();

    const result = await runTurn({
      sessionId: 'session-1',
      permissionMode: 'default',
      goal: 'Cancel the run',
      actionKind: 'cancel',
      actionInput: {
        reason: 'user_requested',
        scope: 'run',
      },
      lifecycle: sink,
      hostBoundary: { handleAction },
      clock: { now: () => '2026-05-16T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      },
    });

    expect(handleAction).not.toHaveBeenCalled();
    expect(result.observations).toContainEqual(
      expect.objectContaining({
        source: 'checkpoint',
        kind: 'cancel_requested',
      }),
    );
    expect(events.map((event) => event.eventType)).toContain('run.cancel.requested');
  });

  it('emits artifact referenced events when host returns artifact reference observation', async () => {
    const { sink } = createSink();
    const result = await runTurn({
      sessionId: 'session:artifact',
      permissionMode: 'default',
      goal: 'Reference report',
      actionKind: 'create_artifact',
      actionInputPreview: {
        artifactId: 'artifact:1',
        artifactVersionId: 'artifact-version:1',
        referencedByKind: 'run',
        referencedById: 'run:next',
      },
      lifecycle: sink,
      hostBoundary: {
        handleAction: (action) => ({
          observationId: 'observation:artifact-ref',
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'runtime',
          kind: 'artifact_referenced',
          receivedAt: '2026-05-16T00:00:00.000Z',
          summary: 'Artifact referenced.',
          metadata: {
            artifactId: 'artifact:1',
            artifactVersionId: 'artifact-version:1',
            referencedByKind: 'run',
            referencedById: 'run:next',
          },
        }),
      },
      clock: { now: () => '2026-05-16T00:00:00.000Z' },
      ids: {
        ...ids,
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      },
    });

    expect(result.events.map((event) => event.eventType)).toContain('artifact.referenced');
  });
});


