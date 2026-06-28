// Owns terminal run lifecycle orchestration for cancellation and startup cleanup.
// It coordinates product persistence and runtime events without depending on
// Desktop, IPC, UI shell, or chat-stream projection concerns.
import {
  createRuntimeEvent,
  type RuntimeError,
  type RuntimeEvent,
} from '@megumi/shared/runtime';
import type { Run, RunStep } from '@megumi/shared/session';
import type { ToolExecution } from '@megumi/shared/tool';
import { createInterruptedExecutionObservation } from '@megumi/coding-agent/tools/observations';
import { createRunStatusChangedEvent } from '../events';
import { createTerminalRuntimeError } from './run-error';
import {
  assertRunStatusTransition,
  canCancelRunStatus,
  isTerminalRunStatus,
} from './run-state-policy';

export interface RunTerminalCoordinatorIds {
  eventId(): string;
}

export interface RunTerminalRepositoryPort {
  getRun(runId: string): Run | undefined;
  saveRun(run: Run): Run;
  saveStep(step: RunStep): RunStep;
  listStepsByRun(runId: string): RunStep[];
  listRunsByStatuses(statuses: Run['status'][]): Run[];
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent;
}

export interface RunTerminalToolRepositoryPort {
  cancelPendingApprovalRequestsByRun(input: { runId: string; resolvedAt: string }): unknown[];
  cancelPendingToolExecutionsByRun(input: {
    runId: string;
    completedAt: string;
    statuses?: readonly ToolExecution['status'][];
  }): unknown[];
  failRunningToolExecutionsByRun(input: {
    runId: string;
    completedAt: string;
    createObservation(record: ToolExecution): ToolExecution['observation'];
  }): unknown[];
}

export interface RunTerminalCoordinatorOptions {
  repository: RunTerminalRepositoryPort;
  toolRepository?: RunTerminalToolRepositoryPort;
  ids: RunTerminalCoordinatorIds;
}

export interface ActiveSessionMessageRunRef {
  sessionId: string;
  runId: string;
  stepId: string;
}

export interface CancelActiveSessionMessageRunInput {
  activeRun: ActiveSessionMessageRunRef;
  targetRequestId: string;
  cancelRequestId: string;
  cancelledAt: string;
  providerCancelled: boolean;
  cancelPendingApprovalGroupsByRun?: (runId: string) => void;
  appendEvent?: (event: RuntimeEvent) => void;
}

export interface CancelActiveSessionMessageRunResult {
  handled: boolean;
  shouldForgetActiveRun: boolean;
}

export interface CleanupInterruptedRunsOnStartupInput {
  cleanupAt: string;
  appendEvent?: (event: RuntimeEvent) => void;
}

export interface CleanupInterruptedRunsOnStartupResult {
  cleanedRunIds: string[];
}

export class RunTerminalCoordinator {
  private readonly repository: RunTerminalRepositoryPort;
  private readonly toolRepository?: RunTerminalToolRepositoryPort;
  private readonly ids: RunTerminalCoordinatorIds;

  constructor(options: RunTerminalCoordinatorOptions) {
    this.repository = options.repository;
    this.toolRepository = options.toolRepository;
    this.ids = options.ids;
  }

  cancelActiveSessionMessageRun(input: CancelActiveSessionMessageRunInput): CancelActiveSessionMessageRunResult {
    const persistedRun = this.repository.getRun(input.activeRun.runId);
    if (!persistedRun || isTerminalRunStatus(persistedRun.status)) {
      return { handled: false, shouldForgetActiveRun: true };
    }
    if (!canCancelRunStatus(persistedRun.status)) {
      return { handled: false, shouldForgetActiveRun: false };
    }

    const appendEvent = input.appendEvent ?? ((event: RuntimeEvent) => {
      this.repository.appendRuntimeEvent(event);
    });
    const lastSequence = nextRuntimeSequence(this.repository.listRuntimeEventsByRun(input.activeRun.runId));
    const runningStep = this.repository.listStepsByRun(input.activeRun.runId)
      .reverse()
      .find((step) => ['running', 'waiting_for_approval'].includes(step.status));

    if (runningStep) {
      this.repository.saveStep({
        ...runningStep,
        status: 'cancelled',
        completedAt: input.cancelledAt,
      });
    }

    assertRunStatusTransition(persistedRun.status, 'cancelling');
    const cancellingRun = this.repository.saveRun({
      ...persistedRun,
      status: 'cancelling',
    });

    appendEvent(createRunStatusChangedEvent({
      eventId: this.ids.eventId(),
      sessionId: input.activeRun.sessionId,
      runId: input.activeRun.runId,
      sequence: lastSequence + 1,
      createdAt: input.cancelledAt,
      from: persistedRun.status,
      to: 'cancelling',
    }));
    appendEvent(createRuntimeEvent({
      eventId: this.ids.eventId(),
      eventType: 'run.cancelling',
      runId: input.activeRun.runId,
      sessionId: input.activeRun.sessionId,
      stepId: runningStep?.stepId ?? input.activeRun.stepId,
      requestId: input.targetRequestId,
      sequence: lastSequence + 2,
      createdAt: input.cancelledAt,
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: { cancelRequestId: input.cancelRequestId },
    }));

    input.cancelPendingApprovalGroupsByRun?.(input.activeRun.runId);
    this.toolRepository?.cancelPendingApprovalRequestsByRun({
      runId: input.activeRun.runId,
      resolvedAt: input.cancelledAt,
    });
    this.toolRepository?.cancelPendingToolExecutionsByRun({
      runId: input.activeRun.runId,
      completedAt: input.cancelledAt,
    });

    assertRunStatusTransition(cancellingRun.status, 'cancelled');
    this.repository.saveRun({
      ...cancellingRun,
      status: 'cancelled',
      cancelledAt: input.cancelledAt,
    });
    appendEvent(createRuntimeEvent({
      eventId: this.ids.eventId(),
      eventType: 'run.cancelled',
      runId: input.activeRun.runId,
      sessionId: input.activeRun.sessionId,
      stepId: runningStep?.stepId ?? input.activeRun.stepId,
      requestId: input.targetRequestId,
      sequence: lastSequence + 3,
      createdAt: input.cancelledAt,
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        reason: input.providerCancelled
          ? 'Provider request was cancelled.'
          : 'Session message run was cancelled by the user.',
      },
    }));
    appendEvent(createRunStatusChangedEvent({
      eventId: this.ids.eventId(),
      sessionId: input.activeRun.sessionId,
      runId: input.activeRun.runId,
      sequence: lastSequence + 4,
      createdAt: input.cancelledAt,
      from: 'cancelling',
      to: 'cancelled',
    }));

    return { handled: true, shouldForgetActiveRun: true };
  }

  cleanupInterruptedRunsOnStartup(input: CleanupInterruptedRunsOnStartupInput): CleanupInterruptedRunsOnStartupResult {
    const activeRuns = this.repository.listRunsByStatuses([
      'running',
      'waiting_for_approval',
      'cancelling',
    ]);
    const cleanedRunIds: string[] = [];
    const appendEvent = input.appendEvent ?? ((event: RuntimeEvent) => {
      this.repository.appendRuntimeEvent(event);
    });

    for (const run of activeRuns) {
      const runId = String(run.runId);
      const sessionId = String(run.sessionId);
      const lastSequence = nextRuntimeSequence(this.repository.listRuntimeEventsByRun(runId));
      const error = createStartupCleanupError(run);

      this.toolRepository?.cancelPendingApprovalRequestsByRun({
        runId,
        resolvedAt: input.cleanupAt,
      });
      this.toolRepository?.failRunningToolExecutionsByRun({
        runId,
        completedAt: input.cleanupAt,
        createObservation: (record) => createInterruptedExecutionObservation({
          record,
          ids: { observationId: () => `tool-observation:${record.toolExecutionId}:interrupted` },
          now: () => input.cleanupAt,
        }),
      });
      this.toolRepository?.cancelPendingToolExecutionsByRun({
        runId,
        completedAt: input.cleanupAt,
        statuses: ['created', 'awaitingApproval', 'queued'],
      });
      this.repository.saveRun({
        ...run,
        status: 'failed',
        completedAt: input.cleanupAt,
        error,
      });
      appendEvent(createRuntimeEvent({
        eventId: this.ids.eventId(),
        eventType: 'run.failed',
        runId,
        sessionId,
        sequence: lastSequence + 1,
        createdAt: input.cleanupAt,
        source: 'main',
        visibility: 'user',
        persist: 'required',
        payload: { error },
      }));
      appendEvent(createRunStatusChangedEvent({
        eventId: this.ids.eventId(),
        sessionId,
        runId,
        sequence: lastSequence + 2,
        createdAt: input.cleanupAt,
        from: run.status,
        to: 'failed',
      }));
      cleanedRunIds.push(runId);
    }

    return { cleanedRunIds };
  }
}

function createStartupCleanupError(run: Run): RuntimeError {
  return createTerminalRuntimeError({
    reason: 'runtime_restarted_with_active_run',
    code: 'runtime_restarted_with_active_run',
    message: 'Runtime restarted while this run was active; pending continuation is not recoverable in 19.01.',
    source: 'main',
    retryable: false,
    details: {
      previousStatus: run.status,
      startupCleanup: true,
    },
  });
}

function nextRuntimeSequence(events: RuntimeEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0);
}
