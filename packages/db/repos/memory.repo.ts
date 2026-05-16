import type { MegumiDatabase } from '../connection';
import type {
  MemoryAccessLog,
  MemoryAuditLog,
  MemoryAuditTargetKind,
  MemoryCandidate,
  MemoryCandidateStatus,
  MemoryOwnerKind,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemoryRecordStatus,
  MemorySettings,
  MemorySourceRef,
} from '@megumi/shared/memory-contracts';

interface JsonRow<TColumn extends string> { [key: string]: string }

export class MemoryRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveCandidate(candidate: MemoryCandidate): MemoryCandidate {
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
    `).run(toCandidateRow(candidate));
    candidate.sourceRefs.forEach((ref) => this.saveSourceRef(ref));
    return candidate;
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
    return rows.map((row) => JSON.parse(row.candidate_json) as MemoryCandidate);
  }

  saveMemory(memory: MemoryRecord): MemoryRecord {
    this.database.prepare(`
      INSERT INTO memory_records (
        memory_id, workspace_id, project_id, session_id, scope, kind, status,
        confidence, content, summary, created_from_candidate_id, created_at, updated_at,
        last_accessed_at, access_count, deleted_at, disabled_at, metadata_json, memory_json
      ) VALUES (
        @memory_id, @workspace_id, @project_id, @session_id, @scope, @kind, @status,
        @confidence, @content, @summary, @created_from_candidate_id, @created_at, @updated_at,
        @last_accessed_at, @access_count, @deleted_at, @disabled_at, @metadata_json, @memory_json
      )
      ON CONFLICT(memory_id) DO UPDATE SET
        status = excluded.status,
        content = excluded.content,
        summary = excluded.summary,
        updated_at = excluded.updated_at,
        last_accessed_at = excluded.last_accessed_at,
        access_count = excluded.access_count,
        deleted_at = excluded.deleted_at,
        disabled_at = excluded.disabled_at,
        metadata_json = excluded.metadata_json,
        memory_json = excluded.memory_json
    `).run(toMemoryRow(memory));
    memory.sourceRefs.forEach((ref) => this.saveSourceRef(ref));
    return memory;
  }

  getMemory(memoryId: string): MemoryRecord | undefined {
    return parseJsonRow<MemoryRecord>(this.database.prepare(
      'SELECT memory_json FROM memory_records WHERE memory_id = ?',
    ).get(memoryId), 'memory_json');
  }

  listMemories(filter: { workspaceId?: string; projectId?: string; sessionId?: string; status?: MemoryRecordStatus; query?: string }): MemoryRecord[] {
    const query = filter.query ? `%${filter.query.toLowerCase()}%` : null;
    const rows = this.database.prepare(`
      SELECT memory_json FROM memory_records
      WHERE (@workspace_id IS NULL OR workspace_id = @workspace_id)
        AND (@project_id IS NULL OR project_id = @project_id)
        AND (@session_id IS NULL OR session_id = @session_id)
        AND (@status IS NULL OR status = @status)
        AND (@query IS NULL OR lower(content) LIKE @query OR lower(summary) LIKE @query)
      ORDER BY updated_at DESC
    `).all({
      workspace_id: filter.workspaceId ?? null,
      project_id: filter.projectId ?? null,
      session_id: filter.sessionId ?? null,
      status: filter.status ?? null,
      query,
    }) as Array<{ memory_json: string }>;
    return rows.map((row) => JSON.parse(row.memory_json) as MemoryRecord);
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

  saveSettings(settings: MemorySettings): MemorySettings {
    this.database.prepare(`
      INSERT INTO memory_settings (
        workspace_id, auto_capture_enabled, default_candidate_review_mode,
        updated_at, metadata_json, settings_json
      ) VALUES (
        @workspace_id, @auto_capture_enabled, @default_candidate_review_mode,
        @updated_at, @metadata_json, @settings_json
      )
      ON CONFLICT(workspace_id) DO UPDATE SET
        auto_capture_enabled = excluded.auto_capture_enabled,
        default_candidate_review_mode = excluded.default_candidate_review_mode,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json,
        settings_json = excluded.settings_json
    `).run(toSettingsRow(settings));
    return settings;
  }

  getSettings(workspaceId: string): MemorySettings | undefined {
    return parseJsonRow<MemorySettings>(this.database.prepare(
      'SELECT settings_json FROM memory_settings WHERE workspace_id = ?',
    ).get(workspaceId), 'settings_json');
  }

  saveRecallRequest(request: MemoryRecallRequest): MemoryRecallRequest {
    this.database.prepare(`
      INSERT OR REPLACE INTO memory_recall_requests (
        recall_request_id, session_id, run_id, workspace_id, project_id, query,
        scopes_json, kinds_json, limit_count, budget, created_at, metadata_json, request_json
      ) VALUES (
        @recall_request_id, @session_id, @run_id, @workspace_id, @project_id, @query,
        @scopes_json, @kinds_json, @limit_count, @budget, @created_at, @metadata_json, @request_json
      )
    `).run(toRecallRequestRow(request));
    return request;
  }

  saveRecallResult(result: MemoryRecallResult): MemoryRecallResult {
    this.database.prepare(`
      INSERT OR REPLACE INTO memory_recall_results (
        recall_result_id, recall_request_id, memory_id, scope, kind, relevance_score,
        confidence, selected_for_context, created_at, result_json
      ) VALUES (
        @recall_result_id, @recall_request_id, @memory_id, @scope, @kind, @relevance_score,
        @confidence, @selected_for_context, @created_at, @result_json
      )
    `).run(toRecallResultRow(result));
    return result;
  }

  listRecallResultsByRequest(recallRequestId: string): MemoryRecallResult[] {
    return (this.database.prepare(`
      SELECT result_json FROM memory_recall_results
      WHERE recall_request_id = ?
      ORDER BY relevance_score DESC
    `).all(recallRequestId) as Array<{ result_json: string }>).map((row) => JSON.parse(row.result_json) as MemoryRecallResult);
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
    this.database.prepare(`
      INSERT OR REPLACE INTO memory_audit_logs (
        audit_log_id, target_kind, target_id, operation, actor,
        created_at, summary, metadata_json, audit_log_json
      ) VALUES (
        @audit_log_id, @target_kind, @target_id, @operation, @actor,
        @created_at, @summary, @metadata_json, @audit_log_json
      )
    `).run(toAuditLogRow(auditLog));
    return auditLog;
  }

  listAuditLogs(filter: { targetKind: MemoryAuditTargetKind; targetId: string }): MemoryAuditLog[] {
    const rows = this.database.prepare(`
      SELECT audit_log_json FROM memory_audit_logs
      WHERE target_kind = ? AND target_id = ?
      ORDER BY created_at DESC
    `).all(filter.targetKind, filter.targetId) as Array<{ audit_log_json: string }>;
    return rows.map((row) => JSON.parse(row.audit_log_json) as MemoryAuditLog);
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
    workspace_id: memory.workspaceId ?? null,
    project_id: memory.projectId ?? null,
    session_id: memory.sessionId ?? null,
    scope: memory.scope,
    kind: memory.kind,
    status: memory.status,
    confidence: memory.confidence,
    content: memory.content,
    summary: memory.summary,
    created_from_candidate_id: memory.createdFromCandidateId ?? null,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
    last_accessed_at: memory.lastAccessedAt ?? null,
    access_count: memory.accessCount ?? null,
    deleted_at: memory.deletedAt ?? null,
    disabled_at: memory.disabledAt ?? null,
    metadata_json: memory.metadata ? stringifyJson(memory.metadata) : null,
    memory_json: stringifyJson(memory),
  };
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

function toSettingsRow(settings: MemorySettings) {
  return {
    workspace_id: settings.workspaceId,
    auto_capture_enabled: settings.autoCaptureEnabled ? 1 : 0,
    default_candidate_review_mode: settings.defaultCandidateReviewMode,
    updated_at: settings.updatedAt,
    metadata_json: settings.metadata ? stringifyJson(settings.metadata) : null,
    settings_json: stringifyJson(settings),
  };
}

function toRecallRequestRow(request: MemoryRecallRequest) {
  return {
    recall_request_id: request.recallRequestId,
    session_id: request.sessionId,
    run_id: request.runId ?? null,
    workspace_id: request.workspaceId ?? null,
    project_id: request.projectId ?? null,
    query: request.query ?? null,
    scopes_json: stringifyJson(request.scopes),
    kinds_json: request.kinds ? stringifyJson(request.kinds) : null,
    limit_count: request.limit,
    budget: request.budget ?? null,
    created_at: request.createdAt,
    metadata_json: request.metadata ? stringifyJson(request.metadata) : null,
    request_json: stringifyJson(request),
  };
}

function toRecallResultRow(result: MemoryRecallResult) {
  return {
    recall_result_id: result.recallResultId,
    recall_request_id: result.recallRequestId,
    memory_id: result.memoryId,
    scope: result.scope,
    kind: result.kind,
    relevance_score: result.relevanceScore,
    confidence: result.confidence,
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
    audit_log_id: auditLog.auditLogId,
    target_kind: auditLog.targetKind,
    target_id: auditLog.targetId,
    operation: auditLog.operation,
    actor: auditLog.actor,
    created_at: auditLog.createdAt,
    summary: auditLog.summary,
    metadata_json: auditLog.metadata ? stringifyJson(auditLog.metadata) : null,
    audit_log_json: stringifyJson(auditLog),
  };
}
