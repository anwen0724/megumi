import type { MegumiDatabase } from '../connection';
import type {
  ImplementationPlanArtifactRecord,
  ImplementationPlanArtifactStatus,
  PermissionModeState,
  PermissionSnapshotRecord,
  RunSourcePlanRelation,
} from '@megumi/shared/permission-snapshot-contracts';
import type { JsonObject } from '@megumi/shared/json';

type Nullable<T> = T | null;

interface PermissionSnapshotRow {
  permission_snapshot_id: string;
  run_id: string;
  permission_label: string;
  permission_mode_state_json: string;
  permission_mode: string;
  permission_source: Nullable<string>;
  created_at: string;
  metadata_json: Nullable<string>;
}

interface PlanArtifactRow {
  plan_artifact_id: string;
  producing_run_id: string;
  title: string;
  status: ImplementationPlanArtifactStatus;
  created_at: string;
  updated_at: string;
  accepted_at: Nullable<string>;
  rejected_at: Nullable<string>;
  superseded_at: Nullable<string>;
  superseded_by_plan_id: Nullable<string>;
  metadata_json: Nullable<string>;
}

interface SourcePlanRelationRow {
  run_id: string;
  source_plan_id: string;
  linked_at: string;
  metadata_json: Nullable<string>;
}

export class PermissionSnapshotRepository {
  constructor(private readonly database: MegumiDatabase) {}

  savePermissionSnapshot(snapshot: PermissionSnapshotRecord): PermissionSnapshotRecord {
    this.database.prepare(`
      INSERT INTO permission_snapshots (
        permission_snapshot_id, run_id, permission_label, permission_mode_state_json,
        permission_mode, permission_source, created_at, metadata_json
      ) VALUES (
        @permission_snapshot_id, @run_id, @permission_label, @permission_mode_state_json,
        @permission_mode, @permission_source, @created_at, @metadata_json
      )
      ON CONFLICT(permission_snapshot_id) DO UPDATE SET
        permission_label = excluded.permission_label,
        permission_mode_state_json = excluded.permission_mode_state_json,
        permission_mode = excluded.permission_mode,
        permission_source = excluded.permission_source,
        metadata_json = excluded.metadata_json
    `).run(toPermissionSnapshotRow(snapshot));

    return this.getPermissionSnapshot(snapshot.permissionSnapshotId) ?? snapshot;
  }

  getPermissionSnapshot(permissionSnapshotId: string): PermissionSnapshotRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM permission_snapshots WHERE permission_snapshot_id = ?')
      .get(permissionSnapshotId) as PermissionSnapshotRow | undefined;
    return row ? fromPermissionSnapshotRow(row) : undefined;
  }

  getPermissionSnapshotByRun(runId: string): PermissionSnapshotRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM permission_snapshots WHERE run_id = ?')
      .get(runId) as PermissionSnapshotRow | undefined;
    return row ? fromPermissionSnapshotRow(row) : undefined;
  }

  saveImplementationPlan(plan: ImplementationPlanArtifactRecord): ImplementationPlanArtifactRecord {
    this.database.prepare(`
      INSERT INTO implementation_plan_artifacts (
        plan_artifact_id, producing_run_id, title, status, created_at, updated_at,
        accepted_at, rejected_at, superseded_at, superseded_by_plan_id, metadata_json
      ) VALUES (
        @plan_artifact_id, @producing_run_id, @title, @status, @created_at, @updated_at,
        @accepted_at, @rejected_at, @superseded_at, @superseded_by_plan_id, @metadata_json
      )
      ON CONFLICT(plan_artifact_id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        updated_at = excluded.updated_at,
        accepted_at = excluded.accepted_at,
        rejected_at = excluded.rejected_at,
        superseded_at = excluded.superseded_at,
        superseded_by_plan_id = excluded.superseded_by_plan_id,
        metadata_json = excluded.metadata_json
    `).run(toPlanArtifactRow(plan));

    return this.getImplementationPlan(plan.planArtifactId) ?? plan;
  }

  getImplementationPlan(planArtifactId: string): ImplementationPlanArtifactRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM implementation_plan_artifacts WHERE plan_artifact_id = ?')
      .get(planArtifactId) as PlanArtifactRow | undefined;
    return row ? fromPlanArtifactRow(row) : undefined;
  }

  getImplementationPlanByProducingRun(runId: string): ImplementationPlanArtifactRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM implementation_plan_artifacts WHERE producing_run_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(runId) as PlanArtifactRow | undefined;
    return row ? fromPlanArtifactRow(row) : undefined;
  }

  updateImplementationPlanStatus(input: {
    planArtifactId: string;
    status: ImplementationPlanArtifactStatus;
    updatedAt: string;
    supersededByPlanId?: string;
  }): ImplementationPlanArtifactRecord | undefined {
    const current = this.getImplementationPlan(input.planArtifactId);
    if (!current) {
      return undefined;
    }

    const updated: ImplementationPlanArtifactRecord = {
      ...current,
      status: input.status,
      updatedAt: input.updatedAt,
      ...(input.status === 'accepted' ? { acceptedAt: input.updatedAt } : {}),
      ...(input.status === 'rejected' ? { rejectedAt: input.updatedAt } : {}),
      ...(input.status === 'superseded'
        ? {
            supersededAt: input.updatedAt,
            ...(input.supersededByPlanId ? { supersededByPlanId: input.supersededByPlanId } : {}),
          }
        : {}),
    };

    return this.saveImplementationPlan(updated);
  }

  saveSourcePlanRelation(relation: RunSourcePlanRelation): RunSourcePlanRelation {
    this.database.prepare(`
      INSERT INTO run_source_plans (
        run_id, source_plan_id, linked_at, metadata_json
      ) VALUES (
        @run_id, @source_plan_id, @linked_at, @metadata_json
      )
      ON CONFLICT(run_id) DO UPDATE SET
        source_plan_id = excluded.source_plan_id,
        linked_at = excluded.linked_at,
        metadata_json = excluded.metadata_json
    `).run(toSourcePlanRelationRow(relation));

    return this.getSourcePlanRelation(relation.runId) ?? relation;
  }

  getSourcePlanRelation(runId: string): RunSourcePlanRelation | undefined {
    const row = this.database
      .prepare('SELECT * FROM run_source_plans WHERE run_id = ?')
      .get(runId) as SourcePlanRelationRow | undefined;
    return row ? fromSourcePlanRelationRow(row) : undefined;
  }

  listRunsBySourcePlan(sourcePlanId: string): RunSourcePlanRelation[] {
    return (this.database
      .prepare('SELECT * FROM run_source_plans WHERE source_plan_id = ? ORDER BY linked_at ASC')
      .all(sourcePlanId) as SourcePlanRelationRow[]).map(fromSourcePlanRelationRow);
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

function toPermissionSnapshotRow(snapshot: PermissionSnapshotRecord): PermissionSnapshotRow {
  return {
    permission_snapshot_id: snapshot.permissionSnapshotId,
    run_id: snapshot.runId,
    permission_label: snapshot.permissionLabel,
    permission_mode_state_json: stringifyJson(snapshot.permissionModeState),
    permission_mode: snapshot.permissionModeState.permissionMode,
    permission_source: snapshot.permissionModeState.source ?? null,
    created_at: snapshot.createdAt,
    metadata_json: snapshot.metadata ? stringifyJson(snapshot.metadata) : null,
  };
}

function fromPermissionSnapshotRow(row: PermissionSnapshotRow): PermissionSnapshotRecord {
  return {
    permissionSnapshotId: row.permission_snapshot_id,
    runId: row.run_id,
    permissionLabel: row.permission_label,
    permissionModeState: JSON.parse(row.permission_mode_state_json) as PermissionModeState,
    createdAt: row.created_at,
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

function toPlanArtifactRow(plan: ImplementationPlanArtifactRecord): PlanArtifactRow {
  return {
    plan_artifact_id: plan.planArtifactId,
    producing_run_id: plan.producingRunId,
    title: plan.title,
    status: plan.status,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
    accepted_at: plan.acceptedAt ?? null,
    rejected_at: plan.rejectedAt ?? null,
    superseded_at: plan.supersededAt ?? null,
    superseded_by_plan_id: plan.supersededByPlanId ?? null,
    metadata_json: plan.metadata ? stringifyJson(plan.metadata) : null,
  };
}

function fromPlanArtifactRow(row: PlanArtifactRow): ImplementationPlanArtifactRecord {
  return {
    planArtifactId: row.plan_artifact_id,
    producingRunId: row.producing_run_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.accepted_at ? { acceptedAt: row.accepted_at } : {}),
    ...(row.rejected_at ? { rejectedAt: row.rejected_at } : {}),
    ...(row.superseded_at ? { supersededAt: row.superseded_at } : {}),
    ...(row.superseded_by_plan_id ? { supersededByPlanId: row.superseded_by_plan_id } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

function toSourcePlanRelationRow(relation: RunSourcePlanRelation): SourcePlanRelationRow {
  return {
    run_id: relation.runId,
    source_plan_id: relation.sourcePlanId,
    linked_at: relation.linkedAt,
    metadata_json: relation.metadata ? stringifyJson(relation.metadata) : null,
  };
}

function fromSourcePlanRelationRow(row: SourcePlanRelationRow): RunSourcePlanRelation {
  return {
    runId: row.run_id,
    sourcePlanId: row.source_plan_id,
    linkedAt: row.linked_at,
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}
