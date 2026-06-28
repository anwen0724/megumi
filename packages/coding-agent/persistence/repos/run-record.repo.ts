// Owns persisted Coding Agent run records.
import type { MegumiDatabase } from '../connection';
import type { JsonObject } from '@megumi/shared/primitives';
import type { Run } from '@megumi/shared/session';

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

export class RunRecordRepository {
  constructor(private readonly database: MegumiDatabase) {}

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
    ...(row.error_json ? { error: parseJson(row.error_json) } : {}),
    ...(row.source_plan_id ? { sourcePlanId: row.source_plan_id } : {}),
    ...(row.policy_snapshot_ref ? { policySnapshotRef: row.policy_snapshot_ref } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}
