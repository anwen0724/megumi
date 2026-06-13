// Maps long-term memory shared contracts to SQLite rows. The repository keeps
// SQLite authoritative and does not perform capture, recall scoring, or Markdown IO.
import type { MegumiDatabase } from '../connection';
import {
  MemoryAuditLogSchema,
  MemoryCandidateSchema,
  MemoryMarkdownMirrorSchema,
  MemoryRecallRequestSchema,
  MemoryRecallResultSchema,
  MemoryRecordSchema,
} from '@megumi/shared/memory';
import type {
  MemoryAccessLog,
  MemoryAuditLog,
  MemoryAuditTargetKind,
  MemoryCandidate,
  MemoryCandidateStatus,
  MemoryMarkdownMirror,
  MemoryOwnerKind,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
  MemorySourceRef,
} from '@megumi/shared/memory';

interface JsonRow<TColumn extends string> { [key: string]: string }

export class MemoryRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveCandidate(candidate: MemoryCandidate): MemoryCandidate {
    const parsed = MemoryCandidateSchema.parse(candidate);
    this.database.prepare(`
      INSERT INTO memory_candidates (
        candidate_id, workspace_id, project_id, session_id, scope, kind, status,
        risk_level, confidence, content, summary, proposed_by, created_at, updated_at,
        reviewed_at, reviewed_by, rejection_reason, metadata_json, candidate_json
      ) VALUES (
        @candidate_id, @workspace_id, @project_id, @session_id, @scope, @kind, @status,
        @risk_level, @confidence, @content, @summary, @proposed_by, @created_at, @updated_at,
        @reviewed_at, @reviewed_by, @rejection_reason, @metadata_json, @candidate_json
      )
      ON CONFLICT(candidate_id) DO UPDATE SET
        status = excluded.status,
        content = excluded.content,
        summary = excluded.summary,
        updated_at = excluded.updated_at,
        reviewed_at = excluded.reviewed_at,
        reviewed_by = excluded.reviewed_by,
        rejection_reason = excluded.rejection_reason,
        metadata_json = excluded.metadata_json,
        candidate_json = excluded.candidate_json
    `).run(toCandidateRow(parsed));
    parsed.sourceRefs.forEach((ref) => this.saveSourceRef(ref));
    return parsed;
  }

  getCandidate(candidateId: string): MemoryCandidate | undefined {
    return parseJsonRow<MemoryCandidate>(this.database.prepare(
      'SELECT candidate_json FROM memory_candidates WHERE candidate_id = ?',
    ).get(candidateId), 'candidate_json');
  }

  listCandidates(filter: { workspaceId?: string; sessionId?: string; status?: MemoryCandidateStatus }): MemoryCandidate[] {
    const rows = this.database.prepare(`
      SELECT candidate_json FROM memory_candidates
      WHERE (@workspace_id IS NULL OR workspace_id = @workspace_id)
        AND (@session_id IS NULL OR session_id = @session_id)
        AND (@status IS NULL OR status = @status)
      ORDER BY created_at DESC
    `).all({
      workspace_id: filter.workspaceId ?? null,
      session_id: filter.sessionId ?? null,
      status: filter.status ?? null,
    }) as Array<{ candidate_json: string }>;
    return rows.map((row) => MemoryCandidateSchema.parse(JSON.parse(row.candidate_json)));
  }

  saveMemory(memory: MemoryRecord): MemoryRecord {
    const parsed = MemoryRecordSchema.parse(memory);
    this.database.prepare(`
      INSERT INTO memory_records (
        memory_id, workspace_id, project_id, session_id, scope, kind, status,
        confidence, content, summary, normalized_text, dedupe_key, source,
        source_run_id, source_session_id, source_message_id, source_tool_call_id,
        evidence_json, superseded_by_id, created_from_candidate_id, created_at,
        updated_at, last_accessed_at, access_count, last_used_at, use_count,
        deleted_at, disabled_at, metadata_json, memory_json
      ) VALUES (
        @memory_id, @workspace_id, @project_id, @session_id, @scope, @kind, @status,
        @confidence, @content, @summary, @normalized_text, @dedupe_key, @source,
        @source_run_id, @source_session_id, @source_message_id, @source_tool_call_id,
        @evidence_json, @superseded_by_id, @created_from_candidate_id, @created_at,
        @updated_at, @last_accessed_at, @access_count, @last_used_at, @use_count,
        @deleted_at, @disabled_at, @metadata_json, @memory_json
      )
      ON CONFLICT(memory_id) DO UPDATE SET
        project_id = excluded.project_id,
        session_id = excluded.session_id,
        scope = excluded.scope,
        kind = excluded.kind,
        status = excluded.status,
        confidence = excluded.confidence,
        content = excluded.content,
        summary = excluded.summary,
        normalized_text = excluded.normalized_text,
        dedupe_key = excluded.dedupe_key,
        source = excluded.source,
        source_run_id = excluded.source_run_id,
        source_session_id = excluded.source_session_id,
        source_message_id = excluded.source_message_id,
        source_tool_call_id = excluded.source_tool_call_id,
        evidence_json = excluded.evidence_json,
        superseded_by_id = excluded.superseded_by_id,
        updated_at = excluded.updated_at,
        last_accessed_at = excluded.last_accessed_at,
        access_count = excluded.access_count,
        last_used_at = excluded.last_used_at,
        use_count = excluded.use_count,
        deleted_at = excluded.deleted_at,
        disabled_at = excluded.disabled_at,
        metadata_json = excluded.metadata_json,
        memory_json = excluded.memory_json
    `).run(toMemoryRow(parsed));
    parsed.sourceRefs?.forEach((ref) => this.saveSourceRef(ref));
    return parsed;
  }

  getMemory(memoryId: string): MemoryRecord | undefined {
    const row = this.database.prepare(
      'SELECT * FROM memory_records WHERE memory_id = ?',
    ).get(memoryId) as Record<string, unknown> | undefined;
    return row ? fromMemoryRow(row) : undefined;
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
    const rows = this.database.prepare(`
      SELECT * FROM memory_records
      WHERE (@scope IS NULL OR scope = @scope)
        AND (
          @project_filter_enabled = 0
          OR (@project_id IS NULL AND project_id IS NULL)
          OR project_id = @project_id
        )
        AND (@status IS NULL OR status = @status)
        AND (@kind IS NULL OR kind = @kind)
        AND (@query IS NULL OR lower(content) LIKE @query OR lower(summary) LIKE @query OR lower(normalized_text) LIKE @query)
      ORDER BY updated_at DESC
      LIMIT @limit_count
    `).all({
      scope: filter.scope ?? null,
      project_filter_enabled: projectFilterEnabled,
      project_id: filter.projectId ?? null,
      status: filter.status ?? null,
      kind: filter.kind ?? null,
      query,
      limit_count: filter.limit ?? 1000,
    }) as Array<Record<string, unknown>>;
    return rows.map(fromMemoryRow);
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
        AND ifnull(project_id, '') = ifnull(@project_id, '')
        AND kind = @kind
        AND dedupe_key = @dedupe_key
        AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get({
      scope: input.scope,
      project_id: input.projectId ?? null,
      kind: input.kind,
      dedupe_key: input.dedupeKey,
    }) as Record<string, unknown> | undefined;
    return row ? fromMemoryRow(row) : null;
  }

  saveMarkdownMirror(mirror: MemoryMarkdownMirror): void {
    const parsed = MemoryMarkdownMirrorSchema.parse(mirror);
    this.database.prepare(`
      INSERT INTO memory_markdown_mirrors (
        mirror_id, scope, project_id, file_path, status, last_imported_at,
        last_exported_at, content_hash, last_error, metadata_json, created_at, updated_at
      ) VALUES (
        @mirror_id, @scope, @project_id, @file_path, @status, @last_imported_at,
        @last_exported_at, @content_hash, @last_error, @metadata_json, @created_at, @updated_at
      )
      ON CONFLICT(mirror_id) DO UPDATE SET
        scope = excluded.scope,
        project_id = excluded.project_id,
        file_path = excluded.file_path,
        status = excluded.status,
        last_imported_at = excluded.last_imported_at,
        last_exported_at = excluded.last_exported_at,
        content_hash = excluded.content_hash,
        last_error = excluded.last_error,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(toMarkdownMirrorRow(parsed));
  }

  getMarkdownMirror(mirrorId: string): MemoryMarkdownMirror | null {
    const row = this.database.prepare(
      'SELECT * FROM memory_markdown_mirrors WHERE mirror_id = ?',
    ).get(mirrorId) as Record<string, unknown> | undefined;
    return row ? fromMarkdownMirrorRow(row) : null;
  }

  listMarkdownMirrors(filter: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryMarkdownMirror['status'];
  } = {}): MemoryMarkdownMirror[] {
    const projectFilterEnabled = Object.hasOwn(filter, 'projectId') ? 1 : 0;
    const rows = this.database.prepare(`
      SELECT * FROM memory_markdown_mirrors
      WHERE (@scope IS NULL OR scope = @scope)
        AND (
          @project_filter_enabled = 0
          OR (@project_id IS NULL AND project_id IS NULL)
          OR project_id = @project_id
        )
        AND (@status IS NULL OR status = @status)
      ORDER BY updated_at DESC
    `).all({
      scope: filter.scope ?? null,
      project_filter_enabled: projectFilterEnabled,
      project_id: filter.projectId ?? null,
      status: filter.status ?? null,
    }) as Array<Record<string, unknown>>;
    return rows.map(fromMarkdownMirrorRow);
  }

  saveSourceRef(sourceRef: MemorySourceRef): MemorySourceRef {
    this.database.prepare(`
      INSERT OR REPLACE INTO memory_source_refs (
        source_ref_id, owner_id, owner_kind, kind, ref_id, label,
        excerpt_preview, created_at, metadata_json, source_ref_json
      ) VALUES (
        @source_ref_id, @owner_id, @owner_kind, @kind, @ref_id, @label,
        @excerpt_preview, @created_at, @metadata_json, @source_ref_json
      )
    `).run(toSourceRefRow(sourceRef));
    return sourceRef;
  }

  listSourceRefsByOwner(ownerId: string, ownerKind: MemoryOwnerKind): MemorySourceRef[] {
    const rows = this.database.prepare(`
      SELECT source_ref_json FROM memory_source_refs
      WHERE owner_id = ? AND owner_kind = ?
      ORDER BY created_at ASC
    `).all(ownerId, ownerKind) as Array<{ source_ref_json: string }>;
    return rows.map((row) => JSON.parse(row.source_ref_json) as MemorySourceRef);
  }

  saveRecallRequest(request: MemoryRecallRequest): MemoryRecallRequest {
    const parsed = MemoryRecallRequestSchema.parse(request);
    this.database.prepare(`
      INSERT OR REPLACE INTO memory_recall_requests (
        recall_request_id, session_id, run_id, workspace_id, project_id, query,
        scopes_json, kinds_json, limit_count, budget, created_at, metadata_json, request_json
      ) VALUES (
        @recall_request_id, @session_id, @run_id, @workspace_id, @project_id, @query,
        @scopes_json, @kinds_json, @limit_count, @budget, @created_at, @metadata_json, @request_json
      )
    `).run(toRecallRequestRow(parsed));
    return parsed;
  }

  saveRecallResult(result: MemoryRecallResult): MemoryRecallResult {
    const parsed = MemoryRecallResultSchema.parse(result);
    this.database.prepare(`
      INSERT OR REPLACE INTO memory_recall_results (
        recall_result_id, recall_request_id, memory_id, scope, kind, relevance_score,
        confidence, selected_for_context, created_at, result_json
      ) VALUES (
        @recall_result_id, @recall_request_id, @memory_id, @scope, @kind, @relevance_score,
        @confidence, @selected_for_context, @created_at, @result_json
      )
    `).run(toRecallResultRow(parsed));
    return parsed;
  }

  listRecallResultsByRequest(recallRequestId: string): MemoryRecallResult[] {
    return (this.database.prepare(`
      SELECT result_json FROM memory_recall_results
      WHERE recall_request_id = ?
      ORDER BY relevance_score DESC
    `).all(recallRequestId) as Array<{ result_json: string }>).map((row) =>
      MemoryRecallResultSchema.parse(JSON.parse(row.result_json)),
    );
  }

  saveAccessLog(accessLog: MemoryAccessLog): MemoryAccessLog {
    this.database.prepare(`
      INSERT OR REPLACE INTO memory_access_logs (
        access_log_id, memory_id, session_id, run_id, recall_request_id,
        access_kind, accessed_at, selected_for_context, metadata_json, access_log_json
      ) VALUES (
        @access_log_id, @memory_id, @session_id, @run_id, @recall_request_id,
        @access_kind, @accessed_at, @selected_for_context, @metadata_json, @access_log_json
      )
    `).run(toAccessLogRow(accessLog));
    return accessLog;
  }

  listAccessLogs(filter: { memoryId?: string; sessionId?: string; runId?: string; limit?: number }): MemoryAccessLog[] {
    const rows = this.database.prepare(`
      SELECT access_log_json FROM memory_access_logs
      WHERE (@memory_id IS NULL OR memory_id = @memory_id)
        AND (@session_id IS NULL OR session_id = @session_id)
        AND (@run_id IS NULL OR run_id = @run_id)
      ORDER BY accessed_at DESC
      LIMIT @limit_count
    `).all({
      memory_id: filter.memoryId ?? null,
      session_id: filter.sessionId ?? null,
      run_id: filter.runId ?? null,
      limit_count: filter.limit ?? 100,
    }) as Array<{ access_log_json: string }>;
    return rows.map((row) => JSON.parse(row.access_log_json) as MemoryAccessLog);
  }

  saveAuditLog(auditLog: MemoryAuditLog): MemoryAuditLog {
    const parsed = MemoryAuditLogSchema.parse(auditLog);
    this.database.prepare(`
      INSERT OR REPLACE INTO memory_audit_logs (
        audit_log_id, target_kind, target_id, operation, actor,
        created_at, summary, metadata_json, audit_log_json
      ) VALUES (
        @audit_log_id, @target_kind, @target_id, @operation, @actor,
        @created_at, @summary, @metadata_json, @audit_log_json
      )
    `).run(toAuditLogRow(parsed));
    return parsed;
  }

  listAuditLogs(filter: { targetKind: MemoryAuditTargetKind; targetId: string }): MemoryAuditLog[] {
    const rows = this.database.prepare(`
      SELECT audit_log_json FROM memory_audit_logs
      WHERE target_kind = ? AND target_id = ?
      ORDER BY created_at DESC
    `).all(filter.targetKind, filter.targetId) as Array<{ audit_log_json: string }>;
    return rows.map((row) => MemoryAuditLogSchema.parse(JSON.parse(row.audit_log_json)));
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJsonRow<T>(row: unknown, column: string): T | undefined {
  if (!row || typeof row !== 'object') {
    return undefined;
  }
  const value = (row as JsonRow<typeof column>)[column];
  return typeof value === 'string' ? JSON.parse(value) as T : undefined;
}

function parseOptionalJson(value: unknown): unknown {
  return typeof value === 'string' && value.length > 0 ? JSON.parse(value) : undefined;
}

function parseJsonArray(value: unknown): unknown[] {
  const parsed = parseOptionalJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseOptionalJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function toCandidateRow(candidate: MemoryCandidate) {
  return {
    candidate_id: candidate.candidateId,
    workspace_id: candidate.workspaceId ?? null,
    project_id: candidate.projectId ?? null,
    session_id: candidate.sessionId ?? null,
    scope: candidate.scope,
    kind: candidate.kind,
    status: candidate.status,
    risk_level: candidate.riskLevel,
    confidence: candidate.confidence,
    content: candidate.content,
    summary: candidate.summary,
    proposed_by: candidate.proposedBy,
    created_at: candidate.createdAt,
    updated_at: candidate.updatedAt ?? null,
    reviewed_at: candidate.reviewedAt ?? null,
    reviewed_by: candidate.reviewedBy ?? null,
    rejection_reason: candidate.rejectionReason ?? null,
    metadata_json: candidate.metadata ? stringifyJson(candidate.metadata) : null,
    candidate_json: stringifyJson(candidate),
  };
}

function toMemoryRow(memory: MemoryRecord) {
  return {
    memory_id: memory.memoryId,
    workspace_id: null,
    project_id: memory.projectId ?? null,
    session_id: memory.sourceSessionId ?? null,
    scope: memory.scope,
    kind: memory.kind,
    status: memory.status,
    confidence: memory.confidence ?? 1,
    content: memory.content,
    summary: memory.summary ?? memory.content,
    normalized_text: memory.normalizedText,
    dedupe_key: memory.dedupeKey,
    source: memory.source,
    source_run_id: memory.sourceRunId ?? null,
    source_session_id: memory.sourceSessionId ?? null,
    source_message_id: memory.sourceMessageId ?? null,
    source_tool_call_id: memory.sourceToolCallId ?? null,
    evidence_json: stringifyJson(memory.evidence),
    superseded_by_id: memory.supersededById ?? null,
    created_from_candidate_id: memory.createdFromCandidateId ?? null,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
    last_accessed_at: memory.lastUsedAt ?? null,
    access_count: memory.useCount,
    last_used_at: memory.lastUsedAt ?? null,
    use_count: memory.useCount,
    deleted_at: memory.deletedAt ?? null,
    disabled_at: null,
    metadata_json: stringifyJson(memory.metadata),
    memory_json: stringifyJson(memory),
  };
}

function fromMemoryRow(row: Record<string, unknown>): MemoryRecord {
  const memoryJson = parseOptionalJson(row.memory_json);
  const parsed = MemoryRecordSchema.safeParse(memoryJson);
  if (parsed.success) {
    return parsed.data;
  }

  const legacyScope = asString(row.scope);
  const legacyKind = asString(row.kind);
  const legacyStatus = asString(row.status);
  const content = asString(row.content);
  const scope = legacyScope === 'user' ? 'user' : 'project';
  const projectId = scope === 'project'
    ? nullableString(row.project_id) ?? nullableString(row.workspace_id) ?? 'legacy-project'
    : null;

  return MemoryRecordSchema.parse({
    memoryId: asString(row.memory_id),
    scope,
    projectId,
    kind: mapLegacyKind(legacyKind),
    status: mapLegacyStatus(legacyStatus),
    content,
    summary: nullableString(row.summary),
    normalizedText: asString(row.normalized_text) || normalizeMemoryText(content),
    dedupeKey: asString(row.dedupe_key) || buildFallbackDedupeKey(row),
    source: asString(row.source) || 'manual_system',
    sourceRunId: nullableString(row.source_run_id),
    sourceSessionId: nullableString(row.source_session_id) ?? nullableString(row.session_id),
    sourceMessageId: nullableString(row.source_message_id),
    sourceToolCallId: nullableString(row.source_tool_call_id),
    evidence: parseJsonArray(row.evidence_json),
    supersededById: nullableString(row.superseded_by_id),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    lastUsedAt: nullableString(row.last_used_at) ?? nullableString(row.last_accessed_at),
    useCount: asNumber(row.use_count) ?? asNumber(row.access_count) ?? 0,
    deletedAt: nullableString(row.deleted_at),
    metadata: parseJsonObject(row.metadata_json),
  });
}

function toMarkdownMirrorRow(mirror: MemoryMarkdownMirror) {
  const timestamp = mirror.lastExportedAt ?? mirror.lastImportedAt ?? '1970-01-01T00:00:00.000Z';
  return {
    mirror_id: mirror.mirrorId,
    scope: mirror.scope,
    project_id: mirror.projectId ?? null,
    file_path: mirror.filePath,
    status: mirror.status,
    last_imported_at: mirror.lastImportedAt ?? null,
    last_exported_at: mirror.lastExportedAt ?? null,
    content_hash: mirror.contentHash ?? null,
    last_error: mirror.lastError ?? null,
    metadata_json: stringifyJson(mirror.metadata),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function fromMarkdownMirrorRow(row: Record<string, unknown>): MemoryMarkdownMirror {
  return MemoryMarkdownMirrorSchema.parse({
    mirrorId: asString(row.mirror_id),
    scope: asString(row.scope),
    projectId: nullableString(row.project_id),
    filePath: asString(row.file_path),
    status: asString(row.status),
    lastImportedAt: nullableString(row.last_imported_at),
    lastExportedAt: nullableString(row.last_exported_at),
    contentHash: nullableString(row.content_hash),
    lastError: nullableString(row.last_error),
    metadata: parseJsonObject(row.metadata_json),
  });
}

function toSourceRefRow(sourceRef: MemorySourceRef) {
  return {
    source_ref_id: sourceRef.sourceRefId,
    owner_id: sourceRef.ownerId,
    owner_kind: sourceRef.ownerKind,
    kind: sourceRef.kind,
    ref_id: sourceRef.refId,
    label: sourceRef.label ?? null,
    excerpt_preview: sourceRef.excerptPreview ?? null,
    created_at: sourceRef.createdAt,
    metadata_json: sourceRef.metadata ? stringifyJson(sourceRef.metadata) : null,
    source_ref_json: stringifyJson(sourceRef),
  };
}

function toRecallRequestRow(request: MemoryRecallRequest) {
  return {
    recall_request_id: request.recallRequestId,
    session_id: request.sessionId,
    run_id: request.runId,
    workspace_id: null,
    project_id: request.projectId ?? null,
    query: request.queryText,
    scopes_json: stringifyJson(request.requestedScopes),
    kinds_json: request.requestedKinds ? stringifyJson(request.requestedKinds) : null,
    limit_count: request.maxResults,
    budget: null,
    created_at: request.createdAt,
    metadata_json: stringifyJson(request.metadata),
    request_json: stringifyJson(request),
  };
}

function toRecallResultRow(result: MemoryRecallResult) {
  return {
    recall_result_id: result.recallResultId,
    recall_request_id: result.recallRequestId,
    memory_id: result.memoryId,
    // Compatibility columns remain populated because the 18.02 result_json is authoritative.
    scope: 'project',
    kind: 'fact',
    relevance_score: result.score,
    confidence: result.score,
    selected_for_context: result.selectedForContext ? 1 : 0,
    created_at: result.createdAt,
    result_json: stringifyJson(result),
  };
}

function toAccessLogRow(accessLog: MemoryAccessLog) {
  return {
    access_log_id: accessLog.accessLogId,
    memory_id: accessLog.memoryId,
    session_id: accessLog.sessionId ?? null,
    run_id: accessLog.runId ?? null,
    recall_request_id: accessLog.recallRequestId ?? null,
    access_kind: accessLog.accessKind,
    accessed_at: accessLog.accessedAt,
    selected_for_context: accessLog.selectedForContext ? 1 : 0,
    metadata_json: accessLog.metadata ? stringifyJson(accessLog.metadata) : null,
    access_log_json: stringifyJson(accessLog),
  };
}

function toAuditLogRow(auditLog: MemoryAuditLog) {
  return {
    audit_log_id: auditLog.auditId,
    target_kind: auditLog.targetKind,
    target_id: auditLog.targetId ?? null,
    operation: auditLog.operation,
    actor: auditLog.actorKind,
    created_at: auditLog.createdAt,
    summary: auditLog.reason ?? auditLog.operation,
    metadata_json: stringifyJson(auditLog.metadata),
    audit_log_json: stringifyJson(auditLog),
  };
}

function mapLegacyKind(kind: string): MemoryRecord['kind'] {
  if (kind === 'project_fact') {
    return 'fact';
  }
  if (kind === 'workflow') {
    return 'decision';
  }
  if (kind === 'preference' || kind === 'constraint' || kind === 'fact' || kind === 'decision') {
    return kind;
  }
  return 'fact';
}

function mapLegacyStatus(status: string): MemoryRecordStatus {
  if (status === 'archived') {
    return 'superseded';
  }
  if (status === 'disabled') {
    return 'deleted';
  }
  if (status === 'active' || status === 'superseded' || status === 'deleted') {
    return status;
  }
  return 'active';
}

function normalizeMemoryText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim() || 'memory';
}

function buildFallbackDedupeKey(row: Record<string, unknown>): string {
  const scope = asString(row.scope) || 'project';
  const projectId = nullableString(row.project_id) ?? nullableString(row.workspace_id) ?? '';
  const kind = mapLegacyKind(asString(row.kind));
  const normalizedText = normalizeMemoryText(asString(row.content));
  return `${scope}:${projectId}:${kind}:${normalizedText}`;
}
