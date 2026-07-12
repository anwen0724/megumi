/*
 * Persists durable memory records and markdown mirrors.
 * Recall traces and capture attempts are process-local workflow state, not database facts.
 */
import type { JsonObject } from '../../memory/legacy-contracts/memory-json';
import {
  MemoryMarkdownMirrorSchema,
  MemoryRecallRequestSchema,
  MemoryRecallResultSchema,
  MemoryRecordSchema,
} from '../../memory/legacy-contracts/memory-contracts';
import type {
  MemoryMarkdownMirror,
  MemoryOwnerKind,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
  MemorySourceRef,
} from '../../memory/legacy-contracts/memory-contracts';

import type { MegumiDatabase } from '../connection';

interface MemoryRecordRow {
  memory_id: string;
  workspace_id: string | null;
  session_id: string | null;
  scope: MemoryScope;
  kind: MemoryRecord['kind'];
  status: MemoryRecord['status'];
  content: string;
  normalized_text: string;
  summary: string | null;
  confidence: number | null;
  source_json: string | null;
  evidence_json: string | null;
  dedupe_key: string | null;
  superseded_by_id: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  use_count: number;
  metadata_json: string | null;
}

interface MarkdownMirrorRow {
  mirror_id: string;
  memory_id: string;
  workspace_id: string | null;
  target_path: string;
  status: MemoryMarkdownMirror['status'];
  last_exported_at: string | null;
  content_hash: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
}

interface MemoryRecordMetadata {
  memory?: MemoryRecord;
  sourceRefs?: MemorySourceRef[];
  projectId?: string | null;
}

interface MarkdownMirrorMetadata {
  mirror?: MemoryMarkdownMirror;
}

export interface MemoryCaptureAttempt {
  captureAttemptId: string;
  runId?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
  status: string;
  triggerKind: string;
  extractedCount?: number;
  createdMemoryIds?: string[];
  rawOutput?: unknown;
  error?: unknown;
  createdAt: string;
  completedAt?: string | null;
  metadata?: JsonObject;
}

export interface MemoryRecallTrace {
  recallTraceId: string;
  runId: string;
  sessionId?: string | null;
  projectId?: string | null;
  queryText: string;
  request: MemoryRecallRequest;
  results: MemoryRecallResult[];
  selectedCount?: number;
  createdAt: string;
  metadata?: JsonObject;
}

export class MemoryRepository {
  private readonly captureAttempts = new Map<string, MemoryCaptureAttempt>();
  private readonly recallTraces = new Map<string, MemoryRecallTrace>();

  constructor(private readonly database: MegumiDatabase) {}

  saveMemory(memory: MemoryRecord): MemoryRecord {
    const parsed = MemoryRecordSchema.parse(memory);
    const workspaceId = workspaceIdForMemory(this.database, parsed.projectId ?? null);
    this.database.prepare(`
      INSERT INTO memory_records (
        memory_id, workspace_id, session_id, scope, kind, status, content,
        normalized_text, summary, confidence, source_json, evidence_json,
        dedupe_key, superseded_by_id, created_at, updated_at, last_used_at,
        use_count, metadata_json
      ) VALUES (
        @memory_id, @workspace_id, @session_id, @scope, @kind, @status, @content,
        @normalized_text, @summary, @confidence, @source_json, @evidence_json,
        @dedupe_key, @superseded_by_id, @created_at, @updated_at, @last_used_at,
        @use_count, @metadata_json
      )
      ON CONFLICT(memory_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        session_id = excluded.session_id,
        scope = excluded.scope,
        kind = excluded.kind,
        status = excluded.status,
        content = excluded.content,
        normalized_text = excluded.normalized_text,
        summary = excluded.summary,
        confidence = excluded.confidence,
        source_json = excluded.source_json,
        evidence_json = excluded.evidence_json,
        dedupe_key = excluded.dedupe_key,
        superseded_by_id = excluded.superseded_by_id,
        updated_at = excluded.updated_at,
        last_used_at = excluded.last_used_at,
        use_count = excluded.use_count,
        metadata_json = excluded.metadata_json
    `).run({
      memory_id: parsed.memoryId,
      workspace_id: workspaceId,
      session_id: existingSessionId(this.database, parsed.sourceSessionId),
      scope: parsed.scope,
      kind: parsed.kind,
      status: parsed.status,
      content: parsed.content,
      normalized_text: parsed.normalizedText,
      summary: parsed.summary ?? null,
      confidence: parsed.confidence ?? null,
      source_json: stringifyJson({ source: parsed.source }),
      evidence_json: stringifyJson(parsed.evidence),
      dedupe_key: parsed.dedupeKey,
      superseded_by_id: parsed.supersededById ?? null,
      created_at: parsed.createdAt,
      updated_at: parsed.updatedAt,
      last_used_at: parsed.lastUsedAt ?? null,
      use_count: parsed.useCount,
      metadata_json: stringifyJson({
        memory: parsed,
        projectId: parsed.projectId ?? null,
        sourceRefs: parsed.sourceRefs ?? [],
      } satisfies MemoryRecordMetadata),
    });
    return parsed;
  }

  getMemory(memoryId: string): MemoryRecord | undefined {
    const row = this.database.prepare('SELECT * FROM memory_records WHERE memory_id = ?')
      .get(memoryId) as MemoryRecordRow | undefined;
    return row ? fromMemoryRecordRow(row) : undefined;
  }

  listMemories(filter: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    kind?: MemoryRecord['kind'];
    query?: string;
    limit?: number;
  } = {}): MemoryRecord[] {
    const query = filter.query ? `%${filter.query.toLowerCase()}%` : null;
    const projectFilterEnabled = Object.hasOwn(filter, 'projectId') ? 1 : 0;
    return (this.database.prepare(`
      SELECT * FROM memory_records
      WHERE (@scope IS NULL OR scope = @scope)
        AND (
          @project_filter_enabled = 0
          OR ifnull(workspace_id, '') = ifnull(@workspace_id, '')
        )
        AND (@status IS NULL OR status = @status)
        AND (@kind IS NULL OR kind = @kind)
        AND (@query IS NULL OR lower(content) LIKE @query OR lower(ifnull(summary, '')) LIKE @query OR lower(normalized_text) LIKE @query)
      ORDER BY updated_at DESC
      LIMIT @limit_count
    `).all({
      scope: filter.scope ?? null,
      project_filter_enabled: projectFilterEnabled,
      workspace_id: filter.projectId ?? null,
      status: filter.status ?? null,
      kind: filter.kind ?? null,
      query,
      limit_count: filter.limit ?? 1000,
    }) as MemoryRecordRow[]).map(fromMemoryRecordRow);
  }

  findActiveMemoryByDedupeKey(input: {
    scope: MemoryScope;
    projectId?: string | null;
    kind: MemoryRecord['kind'];
    dedupeKey: string;
  }): MemoryRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM memory_records
      WHERE scope = @scope
        AND ifnull(workspace_id, '') = ifnull(@workspace_id, '')
        AND kind = @kind
        AND dedupe_key = @dedupe_key
        AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get({
      scope: input.scope,
      workspace_id: input.projectId ?? null,
      kind: input.kind,
      dedupe_key: input.dedupeKey,
    }) as MemoryRecordRow | undefined;
    return row ? fromMemoryRecordRow(row) : null;
  }

  recordRecallTrace(trace: MemoryRecallTrace): MemoryRecallTrace {
    const request = MemoryRecallRequestSchema.parse(trace.request);
    const results = trace.results.map((result) => MemoryRecallResultSchema.parse(result));
    if (request.recallRequestId !== trace.recallTraceId) {
      throw new Error(`Memory recall trace ${trace.recallTraceId} must use the request id as trace id`);
    }
    if (request.runId !== trace.runId) {
      throw new Error(`Memory recall trace ${trace.recallTraceId} runId does not match request runId`);
    }
    const normalized = {
      ...trace,
      request,
      results,
      selectedCount: trace.selectedCount ?? results.filter((item) => item.selectedForContext).length,
      metadata: trace.metadata ?? {},
    };
    this.recallTraces.set(trace.recallTraceId, normalized);
    return normalized;
  }

  getRecallTrace(recallTraceId: string): MemoryRecallTrace | undefined {
    return this.recallTraces.get(recallTraceId);
  }

  recordCaptureAttempt(attempt: MemoryCaptureAttempt): MemoryCaptureAttempt {
    const normalized = {
      ...attempt,
      extractedCount: attempt.extractedCount ?? 0,
      createdMemoryIds: attempt.createdMemoryIds ?? [],
      completedAt: attempt.completedAt ?? null,
      metadata: attempt.metadata ?? {},
    };
    this.captureAttempts.set(attempt.captureAttemptId, normalized);
    return normalized;
  }

  getCaptureAttempt(captureAttemptId: string): MemoryCaptureAttempt | undefined {
    return this.captureAttempts.get(captureAttemptId);
  }

  listCaptureAttempts(filter: {
    workspaceId?: string | null;
    sessionId?: string | null;
    runId?: string | null;
    status?: string;
    triggerKind?: string;
    limit?: number;
  } = {}): MemoryCaptureAttempt[] {
    return [...this.captureAttempts.values()]
      .filter((item) => filter.workspaceId === undefined || item.workspaceId === filter.workspaceId)
      .filter((item) => filter.sessionId === undefined || item.sessionId === filter.sessionId)
      .filter((item) => filter.runId === undefined || item.runId === filter.runId)
      .filter((item) => filter.status === undefined || item.status === filter.status)
      .filter((item) => filter.triggerKind === undefined || item.triggerKind === filter.triggerKind)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)
        || right.captureAttemptId.localeCompare(left.captureAttemptId))
      .slice(0, filter.limit ?? 1000);
  }

  saveMarkdownMirror(mirror: MemoryMarkdownMirror): void {
    const parsed = MemoryMarkdownMirrorSchema.parse(mirror);
    const now = parsed.lastExportedAt ?? parsed.lastImportedAt ?? new Date(0).toISOString();
    const memoryId = `memory:markdown-mirror:${parsed.mirrorId}`;
    this.ensureMirrorAnchorMemory(memoryId, parsed, now);
    this.database.prepare(`
      INSERT INTO memory_markdown_mirrors (
        mirror_id, memory_id, workspace_id, target_path, status, last_exported_at,
        content_hash, last_error, created_at, updated_at, metadata_json
      ) VALUES (
        @mirror_id, @memory_id, @workspace_id, @target_path, @status, @last_exported_at,
        @content_hash, @last_error, @created_at, @updated_at, @metadata_json
      )
      ON CONFLICT(mirror_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        target_path = excluded.target_path,
        status = excluded.status,
        last_exported_at = excluded.last_exported_at,
        content_hash = excluded.content_hash,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run({
      mirror_id: parsed.mirrorId,
      memory_id: memoryId,
      workspace_id: workspaceIdForMemory(this.database, parsed.projectId ?? null),
      target_path: parsed.filePath,
      status: parsed.status,
      last_exported_at: parsed.lastExportedAt ?? null,
      content_hash: parsed.contentHash ?? null,
      last_error: parsed.lastError ?? null,
      created_at: now,
      updated_at: now,
      metadata_json: stringifyJson({ mirror: parsed } satisfies MarkdownMirrorMetadata),
    });
  }

  getMarkdownMirror(mirrorId: string): MemoryMarkdownMirror | null {
    const row = this.database.prepare('SELECT * FROM memory_markdown_mirrors WHERE mirror_id = ?')
      .get(mirrorId) as MarkdownMirrorRow | undefined;
    return row ? fromMarkdownMirrorRow(row) : null;
  }

  listMarkdownMirrors(filter: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryMarkdownMirror['status'];
  } = {}): MemoryMarkdownMirror[] {
    return (this.database.prepare(`
      SELECT * FROM memory_markdown_mirrors
      WHERE (@workspace_id IS NULL OR workspace_id = @workspace_id)
        AND (@status IS NULL OR status = @status)
      ORDER BY updated_at DESC
    `).all({
      workspace_id: filter.projectId ?? null,
      status: filter.status ?? null,
    }) as MarkdownMirrorRow[])
      .map(fromMarkdownMirrorRow)
      .filter((mirror) => !filter.scope || mirror.scope === filter.scope);
  }

  saveSourceRef(sourceRef: MemorySourceRef): MemorySourceRef {
    if (sourceRef.ownerKind === 'memory') {
      const row = this.database.prepare('SELECT metadata_json FROM memory_records WHERE memory_id = ?')
        .get(sourceRef.ownerId) as { metadata_json: string | null } | undefined;
      const metadata = parseJson<MemoryRecordMetadata>(row?.metadata_json ?? null) ?? {};
      metadata.sourceRefs = mergeById(metadata.sourceRefs ?? [], sourceRef, 'sourceRefId');
      this.database.prepare('UPDATE memory_records SET metadata_json = ? WHERE memory_id = ?')
        .run(stringifyJson(metadata), sourceRef.ownerId);
    } else {
      const attempt = this.getCaptureAttempt(sourceRef.ownerId);
      const metadata = attempt?.metadata ?? {};
      const sourceRefs = mergeById(
        (metadata.sourceRefs as MemorySourceRef[] | undefined) ?? [],
        sourceRef,
        'sourceRefId',
      );
      if (attempt) {
        this.captureAttempts.set(sourceRef.ownerId, {
          ...attempt,
          metadata: { ...metadata, sourceRefs },
        });
      }
    }
    return sourceRef;
  }

  listSourceRefsByOwner(ownerId: string, ownerKind: MemoryOwnerKind): MemorySourceRef[] {
    if (ownerKind === 'memory') {
      const row = this.database.prepare('SELECT metadata_json FROM memory_records WHERE memory_id = ?')
        .get(ownerId) as { metadata_json: string | null } | undefined;
      return parseJson<MemoryRecordMetadata>(row?.metadata_json ?? null)?.sourceRefs ?? [];
    }
    const metadata = this.getCaptureAttempt(ownerId)?.metadata;
    return (metadata?.sourceRefs as MemorySourceRef[] | undefined) ?? [];
  }

  private ensureMirrorAnchorMemory(memoryId: string, mirror: MemoryMarkdownMirror, now: string): void {
    const workspaceId = workspaceIdForMemory(this.database, mirror.projectId ?? null);
    this.database.prepare(`
      INSERT INTO memory_records (
        memory_id, workspace_id, session_id, scope, kind, status, content,
        normalized_text, summary, confidence, source_json, evidence_json,
        dedupe_key, superseded_by_id, created_at, updated_at, last_used_at,
        use_count, metadata_json
      ) VALUES (
        @memory_id, @workspace_id, NULL, @scope, 'fact', 'deleted', @content,
        @normalized_text, @summary, NULL, NULL, '[]',
        @dedupe_key, NULL, @created_at, @updated_at, NULL,
        0, @metadata_json
      )
      ON CONFLICT(memory_id) DO UPDATE SET updated_at = excluded.updated_at
    `).run({
      memory_id: memoryId,
      workspace_id: workspaceId,
      scope: mirror.scope,
      content: `Markdown mirror ${mirror.filePath}`,
      normalized_text: mirror.filePath.toLowerCase(),
      summary: mirror.filePath,
      dedupe_key: memoryId,
      created_at: now,
      updated_at: now,
      metadata_json: stringifyJson({ mirror } satisfies MarkdownMirrorMetadata),
    });
  }
}

function fromMemoryRecordRow(row: MemoryRecordRow): MemoryRecord {
  const metadata = parseJson<MemoryRecordMetadata>(row.metadata_json);
  return metadata?.memory ?? MemoryRecordSchema.parse({
    memoryId: row.memory_id,
    scope: row.scope,
    projectId: metadata?.projectId ?? row.workspace_id,
    kind: row.kind,
    status: row.status,
    content: row.content,
    summary: row.summary ?? undefined,
    normalizedText: row.normalized_text,
    dedupeKey: row.dedupe_key ?? row.memory_id,
    source: parseJson<{ source?: string }>(row.source_json)?.source ?? 'manual_system',
    sourceSessionId: row.session_id ?? undefined,
    evidence: parseJson(row.evidence_json) ?? [],
    supersededById: row.superseded_by_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    useCount: row.use_count,
    metadata: {},
    sourceRefs: metadata?.sourceRefs,
    confidence: row.confidence ?? undefined,
  });
}

function fromMarkdownMirrorRow(row: MarkdownMirrorRow): MemoryMarkdownMirror {
  const metadata = parseJson<MarkdownMirrorMetadata>(row.metadata_json);
  return metadata?.mirror ?? MemoryMarkdownMirrorSchema.parse({
    mirrorId: row.mirror_id,
    scope: 'project',
    projectId: row.workspace_id,
    filePath: row.target_path,
    status: row.status,
    lastExportedAt: row.last_exported_at ?? undefined,
    contentHash: row.content_hash ?? undefined,
    lastError: row.last_error ?? undefined,
    metadata: {},
  });
}

function existingSessionId(database: MegumiDatabase, sessionId: string | null | undefined): string | null {
  if (!sessionId) {
    return null;
  }
  const row = database.prepare('SELECT session_id FROM sessions WHERE session_id = ?')
    .get(sessionId) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}

function workspaceIdForMemory(database: MegumiDatabase, workspaceId: string | null | undefined): string | null {
  if (!workspaceId) {
    return null;
  }
  const row = database.prepare('SELECT workspace_id FROM workspaces WHERE workspace_id = ?')
    .get(workspaceId) as { workspace_id: string } | undefined;
  if (!row) {
    throw new Error(`Memory persistence requires an existing workspace: ${workspaceId}`);
  }
  return row.workspace_id;
}

function mergeById<T extends Record<K, string>, K extends keyof T>(items: T[], next: T, key: K): T[] {
  return [...items.filter((item) => item[key] !== next[key]), next];
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}
