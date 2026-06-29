// Defines persistence ports consumed by the product agent-loop operation implementation.
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type {
  Run,
  RunAction,
  RunObservation,
  RunStep,
  Session,
  SessionCompactionEntry,
  SessionMessage,
} from '@megumi/shared/session';
import type { ModelStepRecord } from './repos/model-step.repo';

export interface AgentRunToolRepositoryPort {
  markToolResultsSubmittedToModelInput(input: {
    toolExecutionIds: string[];
    emittedAt: string;
  }): void;
}

export interface AgentRunSessionRepositoryPort {
  saveSession(session: Session): Session;
  getSession(sessionId: string): Session | undefined;
}

export interface AgentRunMessageRepositoryPort {
  saveMessage(message: SessionMessage): SessionMessage;
  getMessage(messageId: string): SessionMessage | undefined;
}

export interface AgentRunRunRecordRepositoryPort {
  saveRun(run: Run): Run;
  getRun(runId: string): Run | undefined;
  listRunsByStatuses(statuses: Run['status'][]): Run[];
}

export interface AgentRunExecutionFactRepositoryPort {
  saveStep(step: RunStep): RunStep;
  listStepsByRun(runId: string): RunStep[];
  saveAction(action: RunAction): RunAction;
  saveObservation(observation: RunObservation): RunObservation;
}

export interface AgentRunModelStepRepositoryPort {
  saveModelStep(modelStep: ModelStepRecord): ModelStepRecord;
  getModelStep(modelStepId: string): ModelStepRecord | undefined;
}

export interface AgentRunSessionContextRepositoryPort {
  getSessionCompaction(compactionId: string): SessionCompactionEntry | null;
}

export interface AgentRunRuntimeEventRepositoryPort {
  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent;
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}
