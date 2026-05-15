import path from 'node:path';
import { runAgentTurn } from '@megumi/core/agent-runtime/run-agent-turn';
import type { AgentRuntimeIdFactory } from '@megumi/core/agent-runtime/types';
import { createDatabase } from '@megumi/db/connection';
import { AgentLifecycleRepository } from '@megumi/db/repos/agent-lifecycle.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type {
  AgentContext,
  ModelCapabilitySummary,
} from '@megumi/shared/agent-context-contracts';
import type { AgentRun, AgentSession } from '@megumi/shared/agent-lifecycle-contracts';
import type {
  AgentRunStartPayload,
  AgentSessionCreatePayload,
} from '@megumi/shared/ipc-schemas';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
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
  }): AgentContext;
}

export interface AgentLifecycleServiceOptions {
  repository: AgentLifecycleRepository;
  contextService?: AgentRunContextService;
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
    eventId: () => `event:${crypto.randomUUID()}`,
    messageId: () => `message:${crypto.randomUUID()}`,
    debugId: () => `debug:${crypto.randomUUID()}`,
  };
}

export class AgentLifecycleService {
  private readonly repository: AgentLifecycleRepository;
  private readonly contextService?: AgentRunContextService;
  private readonly clock: AgentLifecycleServiceClock;
  private readonly ids: AgentLifecycleServiceIds;

  constructor(options: AgentLifecycleServiceOptions) {
    this.repository = options.repository;
    this.contextService = options.contextService;
    this.clock = options.clock ?? defaultClock;
    this.ids = { ...createDefaultIds(), ...options.ids };
  }

  createSession(payload: AgentSessionCreatePayload): AgentSession {
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

  listSessions(): AgentSession[] {
    return this.repository.listSessions();
  }

  async startRun(payload: AgentRunStartPayload): Promise<{ run: AgentRun; events: RuntimeEvent[] }> {
    const session = this.repository.getSession(payload.sessionId);
    const runId = this.ids.runId();
    const initialContext = this.createInitialContextForRun({
      runId,
      payload,
      session,
    });

    const result = await runAgentTurn({
      sessionId: payload.sessionId,
      ...(payload.triggerMessageId ? { triggerMessageId: payload.triggerMessageId } : {}),
      mode: payload.mode,
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
      hostBoundary: {
        handleAction: (action) => ({
          observationId: this.ids.observationId(),
          runId: action.runId,
          stepId: action.stepId,
          actionId: action.actionId,
          source: 'runtime',
          kind: 'message_emitted',
          receivedAt: this.clock.now(),
          summary: 'Agent lifecycle run completed without tool execution.',
        }),
      },
    });

    return { run: result.run, events: result.events };
  }

  private createInitialContextForRun(input: {
    runId: string;
    payload: AgentRunStartPayload;
    session: AgentSession | undefined;
  }): AgentContext | undefined {
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

  return new AgentLifecycleService({
    repository: new AgentLifecycleRepository(database),
    ...(options.contextService ? { contextService: options.contextService } : {}),
  });
}
