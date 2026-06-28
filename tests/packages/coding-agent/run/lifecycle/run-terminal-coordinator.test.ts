// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { ModelStepRepository, type ModelStepRecord } from '@megumi/coding-agent/persistence/repos/model-step.repo';
import { RunExecutionFactRepository } from '@megumi/coding-agent/persistence/repos/run-execution-fact.repo';
import { RunRecordRepository } from '@megumi/coding-agent/persistence/repos/run-record.repo';
import { RuntimeEventRepository } from '@megumi/coding-agent/persistence/repos/runtime-event.repo';
import { SessionRecordRepository } from '@megumi/coding-agent/persistence/repos/session-record.repo';
import { ToolRepository } from '@megumi/coding-agent/persistence/repos/tool.repo';
import { RunTerminalCoordinator, type RunTerminalRepositoryPort } from '@megumi/coding-agent/run';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { Run, RunStep, Session } from '@megumi/shared/session';
import type { ApprovalRequest, ToolCall, ToolExecution } from '@megumi/shared/tool';

let db: Database.Database | undefined;

interface RunTerminalTestRepository extends RunTerminalRepositoryPort {
  saveModelStep(modelStep: ModelStepRecord): ModelStepRecord;
  saveSession(session: Session): Session;
}

afterEach(() => {
  db?.close();
  db = undefined;
});

function createRepositories() {
  db = new Database(':memory:');
  migrateDatabase(db);
  const modelStepRepository = new ModelStepRepository(db);
  const runExecutionFactRepository = new RunExecutionFactRepository(db);
  const runRecordRepository = new RunRecordRepository(db);
  const runtimeEventRepository = new RuntimeEventRepository(db);
  const sessionRecordRepository = new SessionRecordRepository(db);

  return {
    repository: {
      appendRuntimeEvent: (event: RuntimeEvent) => runtimeEventRepository.appendRuntimeEvent(event),
      getRun: (runId: string) => runRecordRepository.getRun(runId),
      listRuntimeEventsByRun: (runId: string) => runtimeEventRepository.listRuntimeEventsByRun(runId),
      listRunsByStatuses: (statuses: Run['status'][]) => runRecordRepository.listRunsByStatuses(statuses),
      listStepsByRun: (runId: string) => runExecutionFactRepository.listStepsByRun(runId),
      saveModelStep: (modelStep: ModelStepRecord) => modelStepRepository.saveModelStep(modelStep),
      saveRun: (run: Run) => runRecordRepository.saveRun(run),
      saveSession: (session: Session) => sessionRecordRepository.saveSession(session),
      saveStep: (step: RunStep) => runExecutionFactRepository.saveStep(step),
    } satisfies RunTerminalTestRepository,
    toolRepository: new ToolRepository(db),
  };
}

function createCoordinator(input: {
  repository: RunTerminalTestRepository;
  toolRepository?: ToolRepository;
}) {
  let eventIndex = 0;
  return new RunTerminalCoordinator({
    ...input,
    ids: {
      eventId: () => {
        eventIndex += 1;
        return `event-${eventIndex}`;
      },
    },
  });
}

function saveSession(repository: RunTerminalTestRepository): void {
  repository.saveSession({
    sessionId: 'session-1',
    title: 'Lifecycle',
    status: 'active',
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
  });
}

function saveRunningRun(
  repository: RunTerminalTestRepository,
  status: 'queued' | 'running' | 'waiting_for_approval' | 'cancelling' | 'completed' = 'running',
): void {
  saveSession(repository);
  repository.saveRun({
    runId: 'run-1',
    sessionId: 'session-1',
    mode: 'default',
    goal: 'Answer',
    status,
    createdAt: '2026-06-14T00:00:00.000Z',
  });
  repository.saveStep({
    stepId: 'step-1',
    runId: 'run-1',
    kind: 'model',
    status: status === 'waiting_for_approval' ? 'waiting_for_approval' : 'running',
    startedAt: '2026-06-14T00:00:01.000Z',
  });
  repository.saveModelStep({
    modelStepId: 'model-step-1',
    runId: 'run-1',
    stepId: 'step-1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    status: status === 'waiting_for_approval' ? 'waiting_for_approval' : 'running',
    startedAt: '2026-06-14T00:00:01.000Z',
  });
}

function createPendingApproval(input: {
  runId?: string;
  stepId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
  approvalRequestId?: string;
} = {}): {
  toolCall: ToolCall;
  execution: ToolExecution;
  request: ApprovalRequest;
} {
  const runId = input.runId ?? 'run-1';
  const stepId = input.stepId ?? 'step-1';
  const toolCallId = input.toolCallId ?? 'tool-call-1';
  const toolExecutionId = input.toolExecutionId ?? 'tool-execution-1';
  const approvalRequestId = input.approvalRequestId ?? 'approval-1';
  const toolCall: ToolCall = {
    toolCallId,
    runId,
    modelStepId: 'model-step-1',
    providerToolCallId: `provider-${toolCallId}`,
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: {
      summary: 'read README.md',
      targets: [{ kind: 'file', label: 'README.md' }],
      redactionState: 'none',
    },
    status: 'created',
    createdAt: '2026-06-14T00:00:01.500Z',
  };
  const execution: ToolExecution = {
    toolExecutionId,
    toolCallId,
    runId,
    stepId,
    assistantMessageId: 'model-step-1',
    callOrder: 1,
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: {
      summary: 'read README.md',
      targets: [{ kind: 'file', label: 'README.md' }],
      redactionState: 'none',
    },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'awaitingApproval',
    requestedAt: '2026-06-14T00:00:02.000Z',
    continuationEmitted: false,
  };
  const request: ApprovalRequest = {
    approvalRequestId,
    toolCallId,
    toolExecutionId,
    runId,
    stepId,
    toolName: 'read_file',
    capabilities: ['project_read'],
    riskLevel: 'low',
    title: 'Approve read_file',
    summary: 'User approval is required.',
    preview: { action: 'read_file', targets: [] },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-06-14T00:00:03.000Z',
  };
  return { toolCall, execution, request };
}

describe('RunTerminalCoordinator', () => {
  it('cancels an active session message run through lifecycle-owned terminal state and events', () => {
    const { repository, toolRepository } = createRepositories();
    saveRunningRun(repository);
    const { toolCall, execution, request } = createPendingApproval();
    toolRepository.saveToolCall(toolCall);
    toolRepository.saveToolExecution(execution);
    toolRepository.saveApprovalRequest(request);
    const coordinator = createCoordinator({ repository, toolRepository });
    const events: RuntimeEvent[] = [];

    const result = coordinator.cancelActiveSessionMessageRun({
      activeRun: {
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
      },
      targetRequestId: 'request-1',
      cancelRequestId: 'cancel-request-1',
      cancelledAt: '2026-06-14T00:01:00.000Z',
      providerCancelled: false,
      cancelPendingApprovalGroupsByRun: () => {},
      appendEvent: (event) => {
        events.push(event);
        repository.appendRuntimeEvent(event);
      },
    });

    expect(result).toEqual({ handled: true, shouldForgetActiveRun: true });
    expect(repository.getRun('run-1')).toMatchObject({
      status: 'cancelled',
      cancelledAt: '2026-06-14T00:01:00.000Z',
    });
    expect(repository.listStepsByRun('run-1')[0]).toMatchObject({
      status: 'cancelled',
      completedAt: '2026-06-14T00:01:00.000Z',
    });
    expect(toolRepository.getApprovalRequest('approval-1')).toMatchObject({
      status: 'cancelled',
      resolvedAt: '2026-06-14T00:01:00.000Z',
    });
    expect(toolRepository.getToolExecution('tool-execution-1')).toMatchObject({
      status: 'cancelled',
      completedAt: '2026-06-14T00:01:00.000Z',
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'run.status.changed',
      'run.cancelling',
      'run.cancelled',
      'run.status.changed',
    ]);
    expect(repository.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toEqual(events.map((event) => event.eventType));
  });

  it('does not handle missing, terminal, or non-cancellable runs', () => {
    const { repository } = createRepositories();
    const coordinator = createCoordinator({ repository });

    expect(coordinator.cancelActiveSessionMessageRun({
      activeRun: {
        sessionId: 'session-1',
        runId: 'missing-run',
        stepId: 'step-1',
      },
      targetRequestId: 'request-1',
      cancelRequestId: 'cancel-request-1',
      cancelledAt: '2026-06-14T00:01:00.000Z',
      providerCancelled: true,
    })).toEqual({ handled: false, shouldForgetActiveRun: true });

    saveRunningRun(repository, 'completed');
    expect(coordinator.cancelActiveSessionMessageRun({
      activeRun: {
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
      },
      targetRequestId: 'request-1',
      cancelRequestId: 'cancel-request-1',
      cancelledAt: '2026-06-14T00:01:00.000Z',
      providerCancelled: false,
    })).toEqual({ handled: false, shouldForgetActiveRun: true });
  });

  it('cleans interrupted startup runs through lifecycle-owned failed terminal state', () => {
    const { repository, toolRepository } = createRepositories();
    saveRunningRun(repository, 'waiting_for_approval');
    const { toolCall, execution, request } = createPendingApproval();
    toolRepository.saveToolCall(toolCall);
    toolRepository.saveToolExecution(execution);
    toolRepository.saveApprovalRequest(request);
    toolRepository.saveToolCall({
      ...toolCall,
      toolCallId: 'tool-call-running',
      providerToolCallId: 'provider-tool-call-running',
    });
    toolRepository.saveToolExecution({
      ...execution,
      toolExecutionId: 'tool-execution-running',
      toolCallId: 'tool-call-running',
      status: 'running',
      startedAt: '2026-06-14T00:00:05.000Z',
    });
    const coordinator = createCoordinator({ repository, toolRepository });

    const result = coordinator.cleanupInterruptedRunsOnStartup({
      cleanupAt: '2026-06-14T00:01:00.000Z',
    });

    expect(result.cleanedRunIds).toEqual(['run-1']);
    expect(repository.getRun('run-1')).toMatchObject({
      status: 'failed',
      completedAt: '2026-06-14T00:01:00.000Z',
      error: {
        code: 'runtime_restarted_with_active_run',
        details: {
          reason: 'runtime_restarted_with_active_run',
          previousStatus: 'waiting_for_approval',
          startupCleanup: true,
        },
      },
    });
    expect(toolRepository.getApprovalRequest('approval-1')).toMatchObject({
      status: 'cancelled',
      resolvedAt: '2026-06-14T00:01:00.000Z',
    });
    expect(toolRepository.getToolExecution('tool-execution-1')).toMatchObject({
      status: 'cancelled',
      completedAt: '2026-06-14T00:01:00.000Z',
    });
    expect(toolRepository.getToolExecution('tool-execution-running')).toMatchObject({
      status: 'failed',
      completedAt: '2026-06-14T00:01:00.000Z',
      observation: expect.objectContaining({
        isError: true,
        content: expect.stringContaining('Tool execution was interrupted before completion.'),
      }),
    });
    expect(repository.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toEqual([
      'run.failed',
      'run.status.changed',
    ]);
  });
});
