import type { MegumiDatabase } from '../connection';
import type {
  RunContext,
  ContextPatch,
  RunContextSource,
  RunContextBuild,
} from '@megumi/shared/run';
import type { JsonObject } from '@megumi/shared/primitives';

interface BaselineRow {
  context_json: string;
}

interface SourceRow {
  source_json: string;
}

interface PatchRow {
  patch_json: string;
}

interface BuildRow {
  build_json: string;
}

export class RunContextRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveBaseline(context: RunContext): RunContext {
    this.database.prepare(`
      INSERT INTO run_context_baselines (
        context_id, run_id, step_id, baseline_context_id, context_json, created_at, updated_at
      ) VALUES (
        @context_id, @run_id, @step_id, @baseline_context_id, @context_json, @created_at, @updated_at
      )
      ON CONFLICT(context_id) DO UPDATE SET
        context_json = excluded.context_json,
        updated_at = excluded.updated_at
    `).run({
      context_id: context.contextId,
      run_id: context.runId,
      step_id: context.stepId ?? null,
      baseline_context_id: context.baselineContextId ?? null,
      context_json: stringifyJson(context),
      created_at: context.createdAt,
      updated_at: context.updatedAt ?? null,
    });

    return this.getBaseline(context.contextId) ?? context;
  }

  getBaseline(contextId: string): RunContext | undefined {
    const row = this.database
      .prepare('SELECT context_json FROM run_context_baselines WHERE context_id = ?')
      .get(contextId) as BaselineRow | undefined;
    return row ? parseJson<RunContext>(row.context_json) : undefined;
  }

  saveSourceRef(source: RunContextSource & { runId?: string }): RunContextSource {
    const runId = source.runId ?? source.metadata?.runId;
    if (typeof runId !== 'string' || runId.length === 0) {
      throw new Error('Context source ref requires runId for persistence.');
    }

    this.database.prepare(`
      INSERT INTO run_context_source_refs (
        source_id, run_id, source_kind, source_uri, workspace_id, workspace_path, relative_path,
        content_hash, mtime, range_json, loaded_at, freshness, redaction_state, selection_reason,
        metadata_json
      ) VALUES (
        @source_id, @run_id, @source_kind, @source_uri, @workspace_id, @workspace_path, @relative_path,
        @content_hash, @mtime, @range_json, @loaded_at, @freshness, @redaction_state, @selection_reason,
        @metadata_json
      )
      ON CONFLICT(source_id) DO UPDATE SET
        freshness = excluded.freshness,
        redaction_state = excluded.redaction_state,
        selection_reason = excluded.selection_reason,
        metadata_json = excluded.metadata_json
    `).run({
      source_id: source.sourceId,
      run_id: runId,
      source_kind: source.sourceKind,
      source_uri: source.sourceUri,
      workspace_id: source.workspaceId ?? null,
      workspace_path: source.workspacePath ?? null,
      relative_path: source.relativePath ?? null,
      content_hash: source.contentHash ?? null,
      mtime: source.mtime ?? null,
      range_json: source.range ? stringifyJson(source.range) : null,
      loaded_at: source.loadedAt,
      freshness: source.freshness,
      redaction_state: source.redactionState,
      selection_reason: source.selectionReason,
      metadata_json: stringifyJson({ ...source, runId }),
    });

    return source;
  }

  listSourcesByRun(runId: string): RunContextSource[] {
    return (this.database
      .prepare('SELECT metadata_json AS source_json FROM run_context_source_refs WHERE run_id = ? ORDER BY loaded_at ASC')
      .all(runId) as SourceRow[]).map((row) => parseJson<RunContextSource>(row.source_json));
  }

  savePatch(patch: ContextPatch): ContextPatch {
    this.database.prepare(`
      INSERT INTO run_context_patches (
        patch_id, run_id, step_id, requested_by, operation, target_ref, source_ref, reason,
        priority, created_at, applied_at, status, rejection_reason, metadata_json
      ) VALUES (
        @patch_id, @run_id, @step_id, @requested_by, @operation, @target_ref, @source_ref, @reason,
        @priority, @created_at, @applied_at, @status, @rejection_reason, @metadata_json
      )
      ON CONFLICT(patch_id) DO UPDATE SET
        applied_at = excluded.applied_at,
        status = excluded.status,
        rejection_reason = excluded.rejection_reason,
        metadata_json = excluded.metadata_json
    `).run({
      patch_id: patch.patchId,
      run_id: patch.runId,
      step_id: patch.stepId ?? null,
      requested_by: patch.requestedBy,
      operation: patch.operation,
      target_ref: patch.targetRef ?? null,
      source_ref: patch.sourceRef ?? null,
      reason: patch.reason,
      priority: patch.priority ?? null,
      created_at: patch.createdAt,
      applied_at: patch.appliedAt ?? null,
      status: patch.status,
      rejection_reason: patch.rejectionReason ?? null,
      metadata_json: stringifyJson(patch),
    });

    return patch;
  }

  listPatchesByRun(runId: string): ContextPatch[] {
    return (this.database
      .prepare('SELECT metadata_json AS patch_json FROM run_context_patches WHERE run_id = ? ORDER BY created_at ASC')
      .all(runId) as PatchRow[]).map((row) => parseJson<ContextPatch>(row.patch_json));
  }

  saveEffectiveBuild(build: RunContextBuild): RunContextBuild {
    assertSafeBuildMetadata(build.metadata);

    this.database.prepare(`
      INSERT INTO run_context_builds (
        build_id, context_id, run_id, step_id, source_ids_json, selection_record_ids_json,
        redaction_record_ids_json, truncation_record_ids_json, built_at, snapshot_policy, metadata_json
      ) VALUES (
        @build_id, @context_id, @run_id, @step_id, @source_ids_json, @selection_record_ids_json,
        @redaction_record_ids_json, @truncation_record_ids_json, @built_at, @snapshot_policy, @metadata_json
      )
      ON CONFLICT(build_id) DO UPDATE SET
        metadata_json = excluded.metadata_json
    `).run({
      build_id: build.buildId,
      context_id: build.contextId,
      run_id: build.runId,
      step_id: build.stepId ?? null,
      source_ids_json: stringifyJson(build.sourceIds),
      selection_record_ids_json: stringifyJson(build.selectionRecordIds),
      redaction_record_ids_json: stringifyJson(build.redactionRecordIds),
      truncation_record_ids_json: stringifyJson(build.truncationRecordIds),
      built_at: build.builtAt,
      snapshot_policy: build.snapshotPolicy,
      metadata_json: stringifyJson(build),
    });

    return build;
  }

  listEffectiveBuildsByRun(runId: string): RunContextBuild[] {
    return (this.database
      .prepare('SELECT metadata_json AS build_json FROM run_context_builds WHERE run_id = ? ORDER BY built_at ASC')
      .all(runId) as BuildRow[]).map((row) => parseJson<RunContextBuild>(row.build_json));
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function assertSafeBuildMetadata(metadata: JsonObject | undefined): void {
  if (!metadata) {
    return;
  }

  const serialized = JSON.stringify(metadata);
  const unsafeFieldNames = [
    ['exactPromptInput', 'Snapshot'].join(''),
    ['packedModelInput', 'Snapshot'].join(''),
    ['rawFull', 'Prompt'].join(''),
    ['rawRestrictedFile', 'Content'].join(''),
    ['plaintext', 'Secret'].join(''),
  ];
  const hasUnsafeField = unsafeFieldNames.some((field) => serialized.includes(field));
  const hasSecretLikeValue = /(sk-[A-Za-z0-9_-]{12,}|BEGIN (RSA |OPENSSH |PRIVATE )?KEY|password\s*=)/i.test(serialized);

  if (hasUnsafeField || hasSecretLikeValue) {
    throw new Error('Unsafe context snapshot metadata cannot be persisted.');
  }
}

