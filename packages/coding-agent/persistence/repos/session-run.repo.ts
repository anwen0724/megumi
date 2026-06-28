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
import type { JsonObject } from '@megumi/shared/primitives';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { RuntimeEventRepository } from './runtime-event.repo';
import { RunExecutionFactRepository } from './run-execution-fact.repo';
import { ModelStepRepository, type ModelStepRecord } from './model-step.repo';
import { SessionMessageRepository } from './session-message.repo';
import { SessionCompactionRepository } from './session-compaction.repo';
import { SessionContextRepository } from './session-context.repo';
import { SessionRecordRepository } from './session-record.repo';

export type { ModelStepRecord } from './model-step.repo';

type Nullable<T> = T | null;

interface RunRow {
  run_id: string;
  session_id: string;
  trigger_message_id: Nullable<string>;
  agent_definition_id: Nullable<string>;
  agent_config_snapshot_ref: Nullable<string>;
  permission_mode: string;
  permission_snapshot_ref: Nullable<string>;
  goal: string;
  status: Run['status'];
  created_at: string;
  started_at: Nullable<string>;
  completed_at: Nullable<string>;
  cancelled_at: Nullable<string>;
  error_json: Nullable<string>;
  source_plan_id: Nullable<string>;
  policy_snapshot_ref: Nullable<string>;
  metadata_json: Nullable<string>;
}

export class SessionRunRepository {
  private readonly sessions: SessionRecordRepository;
  private readonly runtimeEvents: RuntimeEventRepository;
  private readonly runExecutionFacts: RunExecutionFactRepository;
  private readonly modelSteps: ModelStepRepository;
  private readonly sessionMessages: SessionMessageRepository;
  private readonly sessionCompactions: SessionCompactionRepository;
  private readonly sessionContext: SessionContextRepository;

  constructor(private readonly database: MegumiDatabase) {
    this.sessions = new SessionRecordRepository(database);
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
    this.database.prepare(`
      INSERT INTO runs (
        run_id, session_id, trigger_message_id, agent_definition_id, agent_config_snapshot_ref,
        permission_mode, permission_snapshot_ref, goal, status, created_at, started_at, completed_at,
        cancelled_at, error_json, source_plan_id, policy_snapshot_ref, metadata_json
      ) VALUES (
        @run_id, @session_id, @trigger_message_id, @agent_definition_id, @agent_config_snapshot_ref,
        @permission_mode, @permission_snapshot_ref, @goal, @status, @created_at, @started_at, @completed_at,
        @cancelled_at, @error_json, @source_plan_id, @policy_snapshot_ref, @metadata_json
      )
      ON CONFLICT(run_id) DO UPDATE SET
        trigger_message_id = excluded.trigger_message_id,
        agent_definition_id = excluded.agent_definition_id,
        agent_config_snapshot_ref = excluded.agent_config_snapshot_ref,
        permission_mode = excluded.permission_mode,
        permission_snapshot_ref = excluded.permission_snapshot_ref,
        goal = excluded.goal,
        status = excluded.status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        cancelled_at = excluded.cancelled_at,
        error_json = excluded.error_json,
        source_plan_id = excluded.source_plan_id,
        policy_snapshot_ref = excluded.policy_snapshot_ref,
        metadata_json = excluded.metadata_json
    `).run(toRunRow(run));

    return this.getRun(run.runId) ?? run;
  }

  getRun(runId: string): Run | undefined {
    const row = this.database.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as RunRow | undefined;
    return row ? fromRunRow(row) : undefined;
  }

  listRunsBySession(sessionId: string): Run[] {
    return (this.database
      .prepare('SELECT * FROM runs WHERE session_id = ? ORDER BY created_at ASC, run_id ASC')
      .all(sessionId) as RunRow[]).map(fromRunRow);
  }

  listRunsByStatuses(statuses: Run['status'][]): Run[] {
    if (statuses.length === 0) {
      return [];
    }

    const placeholders = statuses.map(() => '?').join(', ');
    return (this.database
      .prepare(`
        SELECT *
        FROM runs
        WHERE status IN (${placeholders})
        ORDER BY created_at ASC, run_id ASC
      `)
      .all(...statuses) as RunRow[]).map(fromRunRow);
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

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}

function toRunRow(run: Run): RunRow {
  return {
    run_id: run.runId,
    session_id: run.sessionId,
    trigger_message_id: run.triggerMessageId ?? null,
    agent_definition_id: run.agentDefinitionId ?? null,
    agent_config_snapshot_ref: run.agentConfigSnapshotRef ?? null,
    permission_mode: run.mode,
    permission_snapshot_ref: run.permissionSnapshotRef ?? null,
    goal: run.goal,
    status: run.status,
    created_at: run.createdAt,
    started_at: run.startedAt ?? null,
    completed_at: run.completedAt ?? null,
    cancelled_at: run.cancelledAt ?? null,
    error_json: run.error ? stringifyJson(run.error) : null,
    source_plan_id: run.sourcePlanId ?? null,
    policy_snapshot_ref: run.policySnapshotRef ?? null,
    metadata_json: run.metadata ? stringifyJson(run.metadata) : null,
  };
}

function fromRunRow(row: RunRow): Run {
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    ...(row.trigger_message_id ? { triggerMessageId: row.trigger_message_id } : {}),
    ...(row.agent_definition_id ? { agentDefinitionId: row.agent_definition_id } : {}),
    ...(row.agent_config_snapshot_ref ? { agentConfigSnapshotRef: row.agent_config_snapshot_ref } : {}),
    mode: row.permission_mode,
    ...(row.permission_snapshot_ref ? { permissionSnapshotRef: row.permission_snapshot_ref } : {}),
    goal: row.goal,
    status: row.status,
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
    ...(row.error_json ? { error: parseJson<RuntimeError>(row.error_json) } : {}),
    ...(row.source_plan_id ? { sourcePlanId: row.source_plan_id } : {}),
    ...(row.policy_snapshot_ref ? { policySnapshotRef: row.policy_snapshot_ref } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}
