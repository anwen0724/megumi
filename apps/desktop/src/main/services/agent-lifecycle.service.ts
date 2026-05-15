import { runAgentTurn } from '@megumi/core/agent-runtime/run-agent-turn';
import type { AgentRuntimeIdFactory } from '@megumi/core/agent-runtime/types';
import type { AgentLifecycleRepository } from '@megumi/db/repos/agent-lifecycle.repo';
import type { AgentRun, AgentSession } from '@megumi/shared/agent-lifecycle-contracts';
import type {
  AgentRunStartPayload,
  AgentSessionCreatePayload,
} from '@megumi/shared/ipc-schemas';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

export interface AgentLifecycleServiceClock {
  now(): string;
}

export interface AgentLifecycleServiceIds extends AgentRuntimeIdFactory {
  sessionId(): string;
}

export interface AgentLifecycleServiceOptions {
  repository: AgentLifecycleRepository;
  clock?: AgentLifecycleServiceClock;
  ids?: Partial<AgentLifecycleServiceIds>;
}

const defaultClock: AgentLifecycleServiceClock = {
  now: () => new Date().toISOString(),
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
  private readonly clock: AgentLifecycleServiceClock;
  private readonly ids: AgentLifecycleServiceIds;

  constructor(options: AgentLifecycleServiceOptions) {
    this.repository = options.repository;
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

  async startRun(payload: AgentRunStartPayload): Promise<{ run: AgentRun }> {
    const result = await runAgentTurn({
      sessionId: payload.sessionId,
      ...(payload.triggerMessageId ? { triggerMessageId: payload.triggerMessageId } : {}),
      mode: payload.mode,
      goal: payload.goal,
      clock: this.clock,
      ids: this.ids,
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

    return { run: result.run };
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.repository.listRuntimeEventsByRun(runId);
  }
}
