import type { MegumiDatabase } from '../connection';
import type {
  RunAction,
  RunObservation,
  Run,
  Session,
  RunStep,
  SessionMessage,
} from '@megumi/shared/session';
import {
  SessionCompactionEntrySchema,
  type SessionCompactionEntry,
} from '@megumi/shared/session';
import {
  SessionActiveLeafSchema,
  SessionSourceEntrySchema,
  type SessionActiveLeaf,
  type SessionSourceEntry,
} from '@megumi/shared/session';
import type { JsonObject } from '@megumi/shared/primitives';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { RuntimeEventRepository } from './runtime-event.repo';
import { RunExecutionFactRepository } from './run-execution-fact.repo';
import { ModelStepRepository, type ModelStepRecord } from './model-step.repo';

export type { ModelStepRecord } from './model-step.repo';

type Nullable<T> = T | null;

interface SessionRow {
  session_id: string;
  title: string;
  workspace_id: Nullable<string>;
  workspace_path: Nullable<string>;
  status: Session['status'];
  created_at: string;
  updated_at: string;
  archived_at: Nullable<string>;
  summary: Nullable<string>;
  metadata_json: Nullable<string>;
}

interface SessionMessageRow {
  message_id: string;
  session_id: string;
  run_id: Nullable<string>;
  role: SessionMessage['role'];
  content: string;
  status: SessionMessage['status'];
  created_at: string;
  completed_at: Nullable<string>;
  metadata_json: Nullable<string>;
}

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

interface SessionCompactionRow {
  compaction_id: string;
  session_id: string;
  summary: string;
  first_kept_source_ref_json: string;
  tokens_before: number;
  trigger_reason: string;
  status: string;
  created_at: string;
  metadata_json: Nullable<string>;
}

export class SessionRunRepository {
  private readonly runtimeEvents: RuntimeEventRepository;
  private readonly runExecutionFacts: RunExecutionFactRepository;
  private readonly modelSteps: ModelStepRepository;

  constructor(private readonly database: MegumiDatabase) {
    this.runtimeEvents = new RuntimeEventRepository(database);
    this.runExecutionFacts = new RunExecutionFactRepository(database);
    this.modelSteps = new ModelStepRepository(database);
  }

  saveSession(session: Session): Session {
    this.database.prepare(`
      INSERT INTO sessions (
        session_id, title, workspace_id, workspace_path, status, created_at, updated_at,
        archived_at, summary, metadata_json
      ) VALUES (
        @session_id, @title, @workspace_id, @workspace_path, @status, @created_at, @updated_at,
        @archived_at, @summary, @metadata_json
      )
      ON CONFLICT(session_id) DO UPDATE SET
        title = excluded.title,
        workspace_id = excluded.workspace_id,
        workspace_path = excluded.workspace_path,
        status = excluded.status,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at,
        summary = excluded.summary,
        metadata_json = excluded.metadata_json
    `).run(toSessionRow(session));

    return this.getSession(session.sessionId) ?? session;
  }

  getSession(sessionId: string): Session | undefined {
    const row = this.database.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
      | SessionRow
      | undefined;
    return row ? fromSessionRow(row) : undefined;
  }

  listSessions(): Session[] {
    return (this.database
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
      .all() as SessionRow[]).map(fromSessionRow);
  }

  saveSessionCompaction(entry: SessionCompactionEntry): void {
    const parsed = SessionCompactionEntrySchema.parse(entry);

    this.database.prepare(`
      INSERT INTO session_compactions (
        compaction_id,
        session_id,
        summary,
        first_kept_source_ref_json,
        tokens_before,
        trigger_reason,
        status,
        created_at,
        metadata_json
      ) VALUES (
        @compactionId,
        @sessionId,
        @summary,
        @firstKeptSourceRefJson,
        @tokensBefore,
        @triggerReason,
        @status,
        @createdAt,
        @metadataJson
      )
      ON CONFLICT(compaction_id) DO UPDATE SET
        session_id = excluded.session_id,
        summary = excluded.summary,
        first_kept_source_ref_json = excluded.first_kept_source_ref_json,
        tokens_before = excluded.tokens_before,
        trigger_reason = excluded.trigger_reason,
        status = excluded.status,
        created_at = excluded.created_at,
        metadata_json = excluded.metadata_json
    `).run({
      compactionId: parsed.compactionId,
      sessionId: parsed.sessionId,
      summary: parsed.summary,
      firstKeptSourceRefJson: stringifyJson(parsed.firstKeptSourceRef),
      tokensBefore: parsed.tokensBefore,
      triggerReason: parsed.triggerReason,
      status: parsed.status,
      createdAt: parsed.createdAt,
      metadataJson: parsed.metadata ? stringifyJson(parsed.metadata) : null,
    });
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
    const persist = this.database.transaction((
      compaction: SessionCompactionEntry,
      sourceEntry: SessionSourceEntry,
      activeLeaf: SessionActiveLeaf,
      expectedCurrentLeafSourceEntryId: string | undefined,
    ) => {
      this.saveSessionCompaction(compaction);
      const parsedSourceEntry = this.insertSessionSourceEntry(sourceEntry);
      const parsedActiveLeaf = SessionActiveLeafSchema.parse(activeLeaf);
      const currentLeaf = this.getActiveLeafSourceEntryId(parsedActiveLeaf.sessionId);
      const expectedLeaf = expectedCurrentLeafSourceEntryId ?? null;
      let activeLeafAdvanced = false;

      if (currentLeaf === expectedLeaf) {
        this.upsertActiveLeaf(parsedActiveLeaf);
        activeLeafAdvanced = true;
      }

      return {
        sourceEntry: parsedSourceEntry,
        activeLeafAdvanced,
      };
    });

    return persist(
      input.compaction,
      input.sourceEntry,
      input.activeLeaf,
      input.expectedCurrentLeafSourceEntryId,
    );
  }

  getSessionCompaction(compactionId: string): SessionCompactionEntry | null {
    const row = this.database
      .prepare('SELECT * FROM session_compactions WHERE compaction_id = ?')
      .get(compactionId) as SessionCompactionRow | undefined;

    return row ? fromSessionCompactionRow(row) : null;
  }

  listSessionCompactionsBySession(sessionId: string): SessionCompactionEntry[] {
    return (this.database
      .prepare(`
        SELECT *
        FROM session_compactions
        WHERE session_id = ?
        ORDER BY created_at DESC, compaction_id DESC
      `)
      .all(sessionId) as SessionCompactionRow[]).map(fromSessionCompactionRow);
  }

  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null {
    const row = this.database
      .prepare(`
        SELECT *
        FROM session_compactions
        WHERE session_id = ?
          AND status = 'completed'
        ORDER BY created_at DESC, compaction_id DESC
        LIMIT 1
      `)
      .get(sessionId) as SessionCompactionRow | undefined;

    return row ? fromSessionCompactionRow(row) : null;
  }

  saveMessage(message: SessionMessage): SessionMessage {
    this.database.prepare(`
      INSERT INTO session_messages (
        message_id, session_id, run_id, role, content, status, created_at, completed_at, metadata_json
      ) VALUES (
        @message_id, @session_id, @run_id, @role, @content, @status, @created_at, @completed_at, @metadata_json
      )
      ON CONFLICT(message_id) DO UPDATE SET
        run_id = excluded.run_id,
        content = excluded.content,
        status = excluded.status,
        completed_at = excluded.completed_at,
        metadata_json = excluded.metadata_json
    `).run(toSessionMessageRow(message));

    return message;
  }

  getMessage(messageId: string): SessionMessage | undefined {
    const row = this.database.prepare('SELECT * FROM session_messages WHERE message_id = ?').get(messageId) as
      | SessionMessageRow
      | undefined;
    return row ? fromSessionMessageRow(row) : undefined;
  }

  listMessagesBySession(sessionId: string): SessionMessage[] {
    return (this.database
      .prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as SessionMessageRow[]).map(fromSessionMessageRow);
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

  private insertSessionSourceEntry(entry: SessionSourceEntry): SessionSourceEntry {
    const parsed = SessionSourceEntrySchema.parse(entry);
    if (parsed.parentSourceEntryId) {
      this.assertSourceEntryBelongsToSession(
        parsed.sessionId,
        parsed.parentSourceEntryId,
        'parentSourceEntryId',
      );
    }

    this.database.prepare(`
      INSERT INTO session_source_entries (
        source_entry_id,
        session_id,
        parent_source_entry_id,
        source_kind,
        source_id,
        source_uri,
        source_ref_json,
        created_at,
        metadata_json
      ) VALUES (
        @source_entry_id,
        @session_id,
        @parent_source_entry_id,
        @source_kind,
        @source_id,
        @source_uri,
        @source_ref_json,
        @created_at,
        @metadata_json
      )
    `).run({
      source_entry_id: parsed.sourceEntryId,
      session_id: parsed.sessionId,
      parent_source_entry_id: parsed.parentSourceEntryId ?? null,
      source_kind: parsed.sourceRef.sourceKind,
      source_id: parsed.sourceRef.sourceId,
      source_uri: parsed.sourceRef.sourceUri ?? null,
      source_ref_json: stringifyJson(parsed.sourceRef),
      created_at: parsed.createdAt,
      metadata_json: parsed.metadata ? stringifyJson(parsed.metadata) : null,
    });

    return parsed;
  }

  private upsertActiveLeaf(activeLeaf: SessionActiveLeaf): SessionActiveLeaf {
    const parsed = SessionActiveLeafSchema.parse(activeLeaf);
    if (parsed.leafSourceEntryId) {
      this.assertSourceEntryBelongsToSession(parsed.sessionId, parsed.leafSourceEntryId, 'leafSourceEntryId');
    }

    this.database.prepare(`
      INSERT INTO session_active_leaves (
        session_id,
        leaf_source_entry_id,
        updated_at,
        reason,
        metadata_json
      ) VALUES (
        @session_id,
        @leaf_source_entry_id,
        @updated_at,
        @reason,
        @metadata_json
      )
      ON CONFLICT(session_id) DO UPDATE SET
        leaf_source_entry_id = excluded.leaf_source_entry_id,
        updated_at = excluded.updated_at,
        reason = excluded.reason,
        metadata_json = excluded.metadata_json
    `).run({
      session_id: parsed.sessionId,
      leaf_source_entry_id: parsed.leafSourceEntryId ?? null,
      updated_at: parsed.updatedAt,
      reason: parsed.reason,
      metadata_json: parsed.metadata ? stringifyJson(parsed.metadata) : null,
    });

    return parsed;
  }

  private getActiveLeafSourceEntryId(sessionId: string): string | null {
    const row = this.database
      .prepare('SELECT leaf_source_entry_id FROM session_active_leaves WHERE session_id = ?')
      .get(sessionId) as { leaf_source_entry_id: string | null } | undefined;

    return row?.leaf_source_entry_id ?? null;
  }

  private assertSourceEntryBelongsToSession(
    sessionId: string,
    sourceEntryId: string,
    fieldName: string,
  ): void {
    const row = this.database
      .prepare('SELECT session_id FROM session_source_entries WHERE source_entry_id = ?')
      .get(sourceEntryId) as { session_id: string } | undefined;

    if (!row || row.session_id !== sessionId) {
      throw new Error(`${fieldName} must belong to session ${sessionId}`);
    }
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

function toSessionRow(session: Session): SessionRow {
  return {
    session_id: session.sessionId,
    title: session.title,
    workspace_id: session.workspaceId ?? null,
    workspace_path: session.workspacePath ?? null,
    status: session.status,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    archived_at: session.archivedAt ?? null,
    summary: session.summary ?? null,
    metadata_json: session.metadata ? stringifyJson(session.metadata) : null,
  };
}

function fromSessionRow(row: SessionRow): Session {
  return {
    sessionId: row.session_id,
    title: row.title,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.workspace_path ? { workspacePath: row.workspace_path } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

function fromSessionCompactionRow(row: SessionCompactionRow): SessionCompactionEntry {
  return SessionCompactionEntrySchema.parse({
    compactionId: row.compaction_id,
    sessionId: row.session_id,
    summary: row.summary,
    summaryKind: 'compaction',
    firstKeptSourceRef: parseJson(row.first_kept_source_ref_json),
    tokensBefore: row.tokens_before,
    triggerReason: row.trigger_reason,
    status: row.status,
    createdAt: row.created_at,
    metadata: row.metadata_json ? parseJson(row.metadata_json) : undefined,
  });
}

function toSessionMessageRow(message: SessionMessage): SessionMessageRow {
  return {
    message_id: message.messageId,
    session_id: message.sessionId,
    run_id: message.runId ?? null,
    role: message.role,
    content: message.content,
    status: message.status,
    created_at: message.createdAt,
    completed_at: message.completedAt ?? null,
    metadata_json: message.metadata ? stringifyJson(message.metadata) : null,
  };
}

function fromSessionMessageRow(row: SessionMessageRow): SessionMessage {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
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
