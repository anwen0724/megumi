import path from 'node:path';
import { runAgentTurn } from '@megumi/core/agent-runtime/run-agent-turn';
import type { AgentHostBoundaryPort, AgentRuntimeIdFactory } from '@megumi/core/agent-runtime/types';
import { createDatabase } from '@megumi/db/connection';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type {
  RunContext,
  ModelCapabilitySummary,
} from '@megumi/shared/run-context-contracts';
import type { Run, Session } from '@megumi/shared/session-run-contracts';
import type {
  AgentRunStartPayload,
  AgentPlanStatusUpdatePayload,
  AgentSessionCreatePayload,
} from '@megumi/shared/ipc-schemas';
import type { ImplementationPlanArtifactRecord } from '@megumi/shared/run-mode-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { AgentRunModeService } from './agent-run-mode.service';
import type { MegumiHomePaths } from './megumi-home.service';

export interface AgentLifecycleServiceClock {
  now(): string;
}

export interface AgentLifecycleServiceIds extends AgentRuntimeIdFactory {
  sessionId(): string;
}

export interface AgentRunContextService {
  createBaselineContext(input: {
    runId: string;
    goal: string;
    workspaceId: string;
    workspacePath: string;
    modelCapabilitySummary: ModelCapabilitySummary;
  }): RunContext;
}

export interface AgentLifecycleServiceOptions {
  repository: SessionRunRepository;
  contextService?: AgentRunContextService;
  runModeService?: Pick<
    AgentRunModeService,
    | 'createModeSnapshot'
    | 'linkAcceptedSourcePlan'
    | 'createPlanRecordForRun'
    | 'getPlanByRun'
    | 'updatePlanStatus'
  >;
  hostBoundary?: AgentHostBoundaryPort;
  clock?: AgentLifecycleServiceClock;
  ids?: Partial<AgentLifecycleServiceIds>;
}

const defaultClock: AgentLifecycleServiceClock = {
  now: () => new Date().toISOString(),
};

const DEFAULT_AGENT_MODEL_CAPABILITY_SUMMARY: ModelCapabilitySummary = {
  providerId: 'unknown',
  modelId: 'unknown',
  modelContextWindow: 8192,
  reservedOutputTokens: 1024,
  availableInputTokens: 7168,
};

function createDefaultIds(): AgentLifecycleServiceIds {
  return {
    sessionId: () => `session:${crypto.randomUUID()}`,
    runId: () => `run:${crypto.randomUUID()}`,
    stepId: () => `step:${crypto.randomUUID()}`,
    actionId: () => `action:${crypto.randomUUID()}`,
    observationId: () => `observation:${crypto.randomUUID()}`,
    checkpointId: () => `checkpoint:${crypto.randomUUID()}`,
    resumeRequestId: () => `resume-request:${crypto.randomUUID()}`,
    cancelRequestId: () => `cancel-request:${crypto.randomUUID()}`,
    retryRequestId: () => `retry-request:${crypto.randomUUID()}`,
    eventId: () => `event:${crypto.randomUUID()}`,
    messageId: () => `message:${crypto.randomUUID()}`,
    debugId: () => `debug:${crypto.randomUUID()}`,
  };
}

export class AgentLifecycleService {
  private readonly repository: SessionRunRepository;
  private readonly contextService?: AgentRunContextService;
  private readonly runModeService?: Pick<
    AgentRunModeService,
    | 'createModeSnapshot'
    | 'linkAcceptedSourcePlan'
    | 'createPlanRecordForRun'
    | 'getPlanByRun'
    | 'updatePlanStatus'
  >;
  private readonly hostBoundary: AgentHostBoundaryPort;
  private readonly clock: AgentLifecycleServiceClock;
  private readonly ids: AgentLifecycleServiceIds;

  constructor(options: AgentLifecycleServiceOptions) {
    this.repository = options.repository;
    this.contextService = options.contextService;
    this.runModeService = options.runModeService;
    this.clock = options.clock ?? defaultClock;
    this.ids = { ...createDefaultIds(), ...options.ids };
    this.hostBoundary = options.hostBoundary ?? defaultHostBoundary(this.clock, this.ids);
  }

  createSession(payload: AgentSessionCreatePayload): Session {
    return this.repository.saveSession({
      sessionId: this.ids.sessionId(),
      title: payload.title,
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      ...(payload.workspacePath ? { workspacePath: payload.workspacePath } : {}),
      status: 'active',
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    });
  }

  listSessions(): Session[] {
    return this.repository.listSessions();
  }

  async startRun(payload: AgentRunStartPayload): Promise<{ run: Run; events: RuntimeEvent[] }> {
    const session = this.repository.getSession(payload.sessionId);
    const runId = this.ids.runId();
    const modeSnapshot = this.runModeService?.createModeSnapshot({
      runId,
      mode: payload.mode,
      modeSnapshot: payload.modeSnapshot,
      createdAt: payload.createdAt,
    });

    if (payload.sourcePlanId && this.runModeService) {
      this.runModeService.linkAcceptedSourcePlan({
        runId,
        sourcePlanId: payload.sourcePlanId,
        linkedAt: payload.createdAt,
      });
    }

    const initialContext = this.createInitialContextForRun({
      runId,
      payload,
      session,
    });

    const result = await runAgentTurn({
      sessionId: payload.sessionId,
      ...(payload.triggerMessageId ? { triggerMessageId: payload.triggerMessageId } : {}),
      mode: payload.mode,
      ...(modeSnapshot ? {
        modeSnapshot: modeSnapshot.mode,
        modeSnapshotRef: modeSnapshot.modeSnapshotId,
      } : payload.modeSnapshot ? { modeSnapshot: payload.modeSnapshot } : {}),
      ...(payload.sourcePlanId ? { sourcePlanId: payload.sourcePlanId } : {}),
      goal: payload.goal,
      clock: this.clock,
      ids: {
        ...this.ids,
        runId: () => runId,
      },
      ...(initialContext ? { initialContext } : {}),
      lifecycle: {
        saveRun: (run) => {
          this.repository.saveRun(run);
        },
        saveStep: (step) => {
          this.repository.saveStep(step);
        },
        saveAction: (action) => {
          this.repository.saveAction(action);
        },
        saveObservation: (observation) => {
          this.repository.saveObservation(observation);
        },
        appendEvent: (event) => {
          this.repository.appendRuntimeEvent(event);
        },
      },
      hostBoundary: this.hostBoundary,
    });

    if (modeSnapshot && this.runModeService && result.run.status === 'completed') {
      this.runModeService.createPlanRecordForRun({
        runId,
        goal: payload.goal,
        mode: modeSnapshot.mode,
        createdAt: result.run.completedAt ?? payload.createdAt,
      });
    }

    return { run: result.run, events: result.events };
  }

  getPlanByRun(runId: string): ImplementationPlanArtifactRecord | undefined {
    return this.requireRunModeService().getPlanByRun(runId);
  }

  updatePlanStatus(input: AgentPlanStatusUpdatePayload): ImplementationPlanArtifactRecord {
    return this.requireRunModeService().updatePlanStatus(input);
  }

  private createInitialContextForRun(input: {
    runId: string;
    payload: AgentRunStartPayload;
    session: Session | undefined;
  }): RunContext | undefined {
    if (!this.contextService || !input.session?.workspacePath) {
      return undefined;
    }

    return this.contextService.createBaselineContext({
      runId: input.runId,
      goal: input.payload.goal,
      workspaceId: String(input.session.workspaceId ?? `workspace:${input.session.sessionId}`),
      workspacePath: input.session.workspacePath,
      modelCapabilitySummary: DEFAULT_AGENT_MODEL_CAPABILITY_SUMMARY,
    });
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.repository.listRuntimeEventsByRun(runId);
  }

  private requireRunModeService(): NonNullable<AgentLifecycleServiceOptions['runModeService']> {
    if (!this.runModeService) {
      throw new Error('Agent run mode service is not configured.');
    }

    return this.runModeService;
  }
}

function defaultHostBoundary(
  clock: AgentLifecycleServiceClock,
  ids: AgentLifecycleServiceIds,
): AgentHostBoundaryPort {
  return {
    handleAction: (action) => ({
      observationId: ids.observationId(),
      runId: action.runId,
      stepId: action.stepId,
      actionId: action.actionId,
      source: 'runtime',
      kind: 'message_emitted',
      receivedAt: clock.now(),
      summary: 'Agent lifecycle run completed without tool execution.',
    }),
  };
}

export interface CreateDefaultAgentLifecycleServiceOptions {
  contextService?: AgentRunContextService;
}

export function createDefaultAgentLifecycleService(
  homePaths: MegumiHomePaths,
  options: CreateDefaultAgentLifecycleServiceOptions = {},
): AgentLifecycleService {
  const database = createDatabase(path.join(homePaths.sqlitePath, 'megumi.sqlite3'));
  migrateDatabase(database);
  const runModeRepository = new RunModeRepository(database);

  return new AgentLifecycleService({
    repository: new SessionRunRepository(database),
    runModeService: new AgentRunModeService({ repository: runModeRepository }),
    ...(options.contextService ? { contextService: options.contextService } : {}),
  });
}
