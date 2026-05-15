import type {
  AgentAction,
  AgentObservation,
  AgentRun,
  AgentStep,
  Message,
} from '@megumi/shared/agent-lifecycle-contracts';
import { createRuntimeDebugId } from '@megumi/shared/runtime-context';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

export interface AgentRuntimeClock {
  now(): string;
}

export interface AgentRuntimeIdFactory {
  runId(): string;
  stepId(): string;
  actionId(): string;
  observationId(): string;
  eventId(): string;
  messageId(): string;
  debugId(): string;
}

export interface AgentRuntimeLifecycleSink {
  saveRun(run: AgentRun): void | Promise<void>;
  saveStep(step: AgentStep): void | Promise<void>;
  saveAction(action: AgentAction): void | Promise<void>;
  saveObservation(observation: AgentObservation): void | Promise<void>;
  saveMessage?(message: Message): void | Promise<void>;
  appendEvent(event: RuntimeEvent): void | Promise<void>;
}

export interface AgentHostBoundaryPort {
  handleAction(action: AgentAction): Promise<AgentObservation> | AgentObservation;
}

export interface RunAgentTurnInput {
  sessionId: string;
  triggerMessageId?: string;
  mode: string;
  goal: string;
  actionKind?: AgentAction['kind'];
  actionInputPreview?: AgentAction['inputPreview'];
  lifecycle: AgentRuntimeLifecycleSink;
  hostBoundary: AgentHostBoundaryPort;
  clock?: AgentRuntimeClock;
  ids?: Partial<AgentRuntimeIdFactory>;
}

export interface RunAgentTurnResult {
  run: AgentRun;
  step: AgentStep;
  action: AgentAction;
  observation: AgentObservation;
  events: RuntimeEvent[];
}

export const defaultAgentRuntimeClock: AgentRuntimeClock = {
  now: () => new Date().toISOString(),
};

export function createDefaultAgentRuntimeIds(): AgentRuntimeIdFactory {
  return {
    runId: () => `run:${crypto.randomUUID()}`,
    stepId: () => `step:${crypto.randomUUID()}`,
    actionId: () => `action:${crypto.randomUUID()}`,
    observationId: () => `observation:${crypto.randomUUID()}`,
    eventId: () => `event:${crypto.randomUUID()}`,
    messageId: () => `message:${crypto.randomUUID()}`,
    debugId: createRuntimeDebugId,
  };
}
