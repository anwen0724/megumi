import type { MegumiDatabase } from '../connection';
import type {
  RunAction,
  RunObservation,
  Run,
  Session,
  RunStep,
  SessionMessage,
} from '@megumi/shared/session';
import type { SessionCompactionEntry } from '@megumi/shared/session';
import type { SessionActiveLeaf, SessionSourceEntry } from '@megumi/shared/session';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { RunRecordRepository } from './run-record.repo';
import { RuntimeEventRepository } from './runtime-event.repo';
import { RunExecutionFactRepository } from './run-execution-fact.repo';
import { ModelStepRepository, type ModelStepRecord } from './model-step.repo';
import { SessionMessageRepository } from './session-message.repo';
import { SessionCompactionRepository } from './session-compaction.repo';
import { SessionContextRepository } from './session-context.repo';
import { SessionRecordRepository } from './session-record.repo';

export type { ModelStepRecord } from './model-step.repo';

export class SessionRunRepository {
  private readonly sessions: SessionRecordRepository;
  private readonly runs: RunRecordRepository;
  private readonly runtimeEvents: RuntimeEventRepository;
  private readonly runExecutionFacts: RunExecutionFactRepository;
  private readonly modelSteps: ModelStepRepository;
  private readonly sessionMessages: SessionMessageRepository;
  private readonly sessionCompactions: SessionCompactionRepository;
  private readonly sessionContext: SessionContextRepository;

  constructor(private readonly database: MegumiDatabase) {
    this.sessions = new SessionRecordRepository(database);
    this.runs = new RunRecordRepository(database);
    this.runtimeEvents = new RuntimeEventRepository(database);
    this.runExecutionFacts = new RunExecutionFactRepository(database);
    this.modelSteps = new ModelStepRepository(database);
    this.sessionMessages = new SessionMessageRepository(database);
    this.sessionCompactions = new SessionCompactionRepository(database);
    this.sessionContext = new SessionContextRepository(database);
  }

  saveSession(session: Session): Session {
    return this.sessions.saveSession(session);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.getSession(sessionId);
  }

  listSessions(): Session[] {
    return this.sessions.listSessions();
  }

  saveSessionCompaction(entry: SessionCompactionEntry): void {
    this.sessionCompactions.saveSessionCompaction(entry);
  }

  saveSessionCompactionWithActivePath(input: {
    compaction: SessionCompactionEntry;
    sourceEntry: SessionSourceEntry;
    activeLeaf: SessionActiveLeaf;
    expectedCurrentLeafSourceEntryId?: string;
  }): {
    sourceEntry: SessionSourceEntry;
    activeLeafAdvanced: boolean;
  } {
    return this.sessionContext.saveSessionCompactionWithActivePath(input);
  }

  getSessionCompaction(compactionId: string): SessionCompactionEntry | null {
    return this.sessionCompactions.getSessionCompaction(compactionId);
  }

  listSessionCompactionsBySession(sessionId: string): SessionCompactionEntry[] {
    return this.sessionCompactions.listSessionCompactionsBySession(sessionId);
  }

  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null {
    return this.sessionCompactions.getLatestCompletedSessionCompaction(sessionId);
  }

  saveMessage(message: SessionMessage): SessionMessage {
    return this.sessionMessages.saveMessage(message);
  }

  getMessage(messageId: string): SessionMessage | undefined {
    return this.sessionMessages.getMessage(messageId);
  }

  listMessagesBySession(sessionId: string): SessionMessage[] {
    return this.sessionMessages.listMessagesBySession(sessionId);
  }

  saveRun(run: Run): Run {
    return this.runs.saveRun(run);
  }

  getRun(runId: string): Run | undefined {
    return this.runs.getRun(runId);
  }

  listRunsBySession(sessionId: string): Run[] {
    return this.runs.listRunsBySession(sessionId);
  }

  listRunsByStatuses(statuses: Run['status'][]): Run[] {
    return this.runs.listRunsByStatuses(statuses);
  }

  saveStep(step: RunStep): RunStep {
    return this.runExecutionFacts.saveStep(step);
  }

  listStepsByRun(runId: string): RunStep[] {
    return this.runExecutionFacts.listStepsByRun(runId);
  }

  saveModelStep(modelStep: ModelStepRecord): ModelStepRecord {
    return this.modelSteps.saveModelStep(modelStep);
  }

  getModelStep(modelStepId: string): ModelStepRecord | undefined {
    return this.modelSteps.getModelStep(modelStepId);
  }

  saveAction(action: RunAction): RunAction {
    return this.runExecutionFacts.saveAction(action);
  }

  listActionsByRun(runId: string): RunAction[] {
    return this.runExecutionFacts.listActionsByRun(runId);
  }

  saveObservation(observation: RunObservation): RunObservation {
    return this.runExecutionFacts.saveObservation(observation);
  }

  listObservationsByRun(runId: string): RunObservation[] {
    return this.runExecutionFacts.listObservationsByRun(runId);
  }

  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
    return this.runtimeEvents.appendRuntimeEvent(event);
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.runtimeEvents.listRuntimeEventsByRun(runId);
  }

}
