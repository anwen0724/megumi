/* Verifies Headless Runner lifecycle across initial, approval, and terminal streams. */
// @vitest-environment node
import type { RuntimeEvent } from '@megumi/product/runtime-events';
import { describe, expect, it, vi } from 'vitest';
import { EvaluationCaseSchema } from '../../../evals/agent/cases/evaluation-case';
import { ExecutionProfileSchema } from '../../../evals/agent/config/execution-profile';
import { EvaluationTargetSchema } from '../../../evals/agent/config/evaluation-target';
import { runEvaluationAttempt, type EvaluationProductRuntime } from '../../../evals/agent/runner/evaluation-runner';

const profile = ExecutionProfileSchema.parse({
  profileId: 'controlled', name: 'Controlled', environmentKind: 'controlled', permissionMode: 'ask',
  enabledTools: ['read_file'], networkAccess: 'disabled', isolation: 'workspace_only',
  limits: { wallClockMs: 2_000, maxModelCalls: 4, maxToolCalls: 4 },
});
const target = EvaluationTargetSchema.parse({
  targetId: 'test', name: 'Test', providerId: 'test-provider', modelId: 'test-model',
});

describe('runEvaluationAttempt', () => {
  it('runs through Product Host, reaches terminal, reconciles Session, and disposes', async () => {
    const disposed = vi.fn();
    const runtime = runtimeWith({
      initialEvents: [event('run.started'), event('run.completed')],
      disposed,
    });
    const result = await runEvaluationAttempt({
      suiteId: 'smoke',
      repetition: 1,
      evaluationCase: caseWith(),
      target,
      profile,
      runtimeFactory: { create: async () => runtime },
      availableIsolation: ['workspace_only'],
    });

    expect(result.execution.status).toBe('completed');
    expect(result.terminalEvent?.eventType).toBe('run.completed');
    expect(result.session.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: 'OK' })]));
    expect(disposed).toHaveBeenCalledOnce();
  });

  it('matches stable approval facts and consumes multiple continuation streams', async () => {
    const approvalResolve = vi.fn()
      .mockResolvedValueOnce({ payload: { status: 'resumed' }, events: stream([
        approvalEvent('approval-2', 'read_file', '/workspace/two.txt'),
      ]) })
      .mockResolvedValueOnce({ payload: { status: 'resumed' }, events: stream([
        event('run.completed'),
      ]) });
    const runtime = runtimeWith({
      initialEvents: [event('run.started'), approvalEvent('approval-1', 'read_file', '/workspace/one.txt')],
      approvalResolve,
    });
    const result = await runEvaluationAttempt({
      suiteId: 'approval',
      repetition: 1,
      evaluationCase: caseWith({
        approvalScript: [
          { matcher: { toolName: 'read_file', occurrence: 1 }, decision: 'allow_once' },
          { matcher: { toolName: 'read_file', occurrence: 2 }, decision: 'deny' },
        ],
      }),
      target,
      profile,
      runtimeFactory: { create: async () => runtime },
      availableIsolation: ['workspace_only'],
    });

    expect(result.execution.status).toBe('completed');
    expect(approvalResolve).toHaveBeenNthCalledWith(1, {
      approvalRequestId: 'approval-1', decision: 'approved', optionId: 'once',
    });
    expect(approvalResolve).toHaveBeenNthCalledWith(2, {
      approvalRequestId: 'approval-2', decision: 'denied', reason: 'Evaluation approval script denied this request.',
    });
    expect(result.runtimeEvents.map((item) => item.eventType)).toEqual(expect.arrayContaining([
      'approval.requested', 'run.completed',
    ]));
  });

  it('never auto-approves an undeclared approval and safely cancels the run', async () => {
    const approvalResolve = vi.fn();
    const cancelUserInput = vi.fn().mockResolvedValue({ payload: { status: 'cancelled' } });
    const runtime = runtimeWith({
      initialEvents: [event('run.started'), approvalEvent('unexpected', 'read_file', '/workspace/a.txt')],
      approvalResolve,
      cancelUserInput,
    });
    const result = await runEvaluationAttempt({
      suiteId: 'recovery', repetition: 1, evaluationCase: caseWith(), target, profile,
      runtimeFactory: { create: async () => runtime }, availableIsolation: ['workspace_only'],
    });

    expect(result.execution.status).toBe('completed');
    expect(result.outcome).toBe('unexpected_approval');
    expect(approvalResolve).not.toHaveBeenCalled();
    expect(cancelUserInput).toHaveBeenCalledWith({ runId: 'run-1' });
  });

  it('marks a normally ended stream without terminal as runner_failed', async () => {
    const result = await runEvaluationAttempt({
      suiteId: 'broken', repetition: 1, evaluationCase: caseWith(), target, profile,
      runtimeFactory: { create: async () => runtimeWith({ initialEvents: [event('run.started')] }) },
      availableIsolation: ['workspace_only'],
    });
    expect(result.execution.status).toBe('runner_failed');
    expect(result.execution.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'event_stream_missing_terminal' }),
    ]));
  });

  it('cancels at the wall-clock deadline and keeps timeout as an assessable Agent outcome', async () => {
    const cancelUserInput = vi.fn().mockResolvedValue({ payload: { status: 'cancelled' } });
    const shortProfile = ExecutionProfileSchema.parse({ ...profile, limits: { wallClockMs: 20 } });
    const runtime = runtimeWith({
      initialEvents: [],
      eventStream: hangingStream(),
      cancelUserInput,
    });
    const result = await runEvaluationAttempt({
      suiteId: 'timeout', repetition: 1, evaluationCase: caseWith(), target, profile: shortProfile,
      runtimeFactory: { create: async () => runtime }, availableIsolation: ['workspace_only'],
    });
    expect(result.execution.status).toBe('completed');
    expect(result.outcome).toBe('limit_reached');
    expect(result.execution.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'wall_clock_limit_reached' }),
    ]));
    expect(cancelUserInput).toHaveBeenCalledWith({ runId: 'run-1' });
  });

  it('fails setup when an explicitly enabled tool is absent from the resolved Product catalog', async () => {
    const runtime = runtimeWith({
      initialEvents: [event('run.started'), event('run.completed')],
      toolCatalog: [],
    });
    const result = await runEvaluationAttempt({
      suiteId: 'missing-tool', repetition: 1, evaluationCase: caseWith(), target, profile,
      runtimeFactory: { create: async () => runtime }, availableIsolation: ['workspace_only'],
    });

    expect(result.execution.status).toBe('setup_failed');
    expect(result.execution.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('read_file') }),
    ]));
  });

  it('classifies fixture preparation failures as setup failures', async () => {
    const result = await runEvaluationAttempt({
      suiteId: 'fixture', repetition: 1, evaluationCase: caseWith(), target, profile,
      fixtureDirectory: '/definitely/missing/evaluation-fixture',
      runtimeFactory: { create: async () => runtimeWith({ initialEvents: [] }) },
      availableIsolation: ['workspace_only'],
    });

    expect(result.execution.status).toBe('setup_failed');
    expect(result.outcome).toBe('setup_failed');
  });

  it('records public correlation identifiers and retained-environment privacy diagnostics', async () => {
    const result = await runEvaluationAttempt({
      suiteId: 'debug', repetition: 1, evaluationCase: caseWith(), target, profile,
      runtimeFactory: { create: async () => runtimeWith({ initialEvents: [event('run.completed')] }) },
      availableIsolation: ['workspace_only'], retainEnvironment: true,
    });

    expect(result.execution.correlation).toEqual({ workspaceId: 'workspace-1', sessionId: 'session-1', runId: 'run-1' });
    expect(result.retainedEnvironmentPath).toBeTruthy();
    expect(result.execution.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'environment_retained', source: 'cleanup' }),
    ]));
  });
});

function caseWith(overrides: Record<string, unknown> = {}) {
  return EvaluationCaseSchema.parse({
    schemaVersion: 1,
    caseId: 'reply',
    name: 'Reply',
    description: 'Reply case.',
    tags: ['smoke'],
    request: { text: 'Reply with OK.' },
    graders: [{ graderId: 'reply', type: 'final_reply', required: true }],
    ...overrides,
  });
}

function runtimeWith(input: {
  initialEvents: RuntimeEvent[];
  approvalResolve?: ReturnType<typeof vi.fn>;
  cancelUserInput?: ReturnType<typeof vi.fn>;
  disposed?: ReturnType<typeof vi.fn>;
  eventStream?: AsyncIterable<RuntimeEvent>;
  toolCatalog?: Array<{ registeredToolName: string }>;
}): EvaluationProductRuntime {
  return {
    host: {
      workspace: {
        useExistingProject: vi.fn().mockResolvedValue({
          status: 'opened', project: { projectId: 'workspace-1', name: 'workspace', rootPath: '/workspace', status: 'available' },
        }),
      },
      chat: {
        createSession: vi.fn().mockResolvedValue({ status: 'created', session: { id: 'session-1' } }),
        sendUserInput: vi.fn().mockResolvedValue({
          payload: { type: 'agent_run', run: { runId: 'run-1' }, session: { id: 'session-1' } },
          events: input.eventStream ?? stream(input.initialEvents),
        }),
        cancelUserInput: (input.cancelUserInput ?? vi.fn().mockResolvedValue({ payload: { status: 'cancelled' } })) as unknown as EvaluationProductRuntime['host']['chat']['cancelUserInput'],
        listMessages: vi.fn().mockResolvedValue({
          status: 'ok', messages: [{ id: 'reply-1', sessionId: 'session-1', runId: 'run-1', role: 'assistant', text: 'OK', createdAt: new Date().toISOString() }],
        }),
        listTimeline: vi.fn().mockResolvedValue({ messages: [] }),
      },
      approval: { resolve: (input.approvalResolve ?? vi.fn()) as unknown as EvaluationProductRuntime['host']['approval']['resolve'] },
      settings: { get: vi.fn().mockResolvedValue({
        status: 'ok', settings: { permissions: { catalog: { tools: input.toolCatalog ?? [{ registeredToolName: 'read_file' }] } } },
      }) },
      skill: { listSkills: vi.fn().mockResolvedValue({ status: 'ok', skills: [] }) },
      observability: { getRunTrace: vi.fn().mockResolvedValue({ status: 'not_found' }) },
    },
    observability: { flush: vi.fn().mockResolvedValue(undefined) },
    dispose: (input.disposed ?? vi.fn()) as unknown as EvaluationProductRuntime['dispose'],
  };
}

function approvalEvent(approvalRequestId: string, toolName: string, resource: string): RuntimeEvent {
  return event('approval.requested', {
    approvalRequest: {
      approvalRequestId,
      toolCallId: `call-${approvalRequestId}`,
      toolName,
      options: [
        { option_id: 'once', scope: 'once', display: { label: 'Once', description: 'Once' } },
        { option_id: 'session', scope: 'session', display: { label: 'Session', description: 'Session' } },
      ],
      default_option_id: 'once',
      preview: { action: 'workspace.read', targets: [{ kind: 'workspace.path', label: resource }] },
    },
  });
}

function event(eventType: string, payload: Record<string, unknown> = {}): RuntimeEvent {
  return {
    eventId: `${eventType}-${Math.random()}`,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence: 1,
    createdAt: new Date().toISOString(),
    source: 'core',
    visibility: 'system',
    persist: 'transient',
    payload,
  } as RuntimeEvent;
}

async function* stream(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  yield* events;
}

async function* hangingStream(): AsyncIterable<RuntimeEvent> {
  yield event('run.started');
  await new Promise<never>(() => undefined);
}
