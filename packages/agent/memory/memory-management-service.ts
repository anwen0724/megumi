import {
  createDefaultMemoryPolicy,
  createMemoryCandidateDraft,
  evaluateMemoryCandidatePolicy,
  selectMemoryRecallResults,
} from './index';
import type {
  MemoryAccessLog,
  MemoryCandidate,
  MemoryCandidateStatus,
  MemoryKind,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
  MemorySourceRef,
} from './legacy-contracts/memory-contracts';
import type { JsonObject } from './legacy-contracts/memory-json';
import {
  createRuntimeMemoryAccessRecordedEvent,
  createRuntimeMemoryCandidateAcceptedEvent,
  createRuntimeMemoryCandidateProposedEvent,
  createRuntimeMemoryCandidateRejectedEvent,
  createRuntimeMemoryRecallCompletedEvent,
  createRuntimeMemoryRecallRequestedEvent,
  createRuntimeMemoryRecordCreatedEvent,
  createRuntimeMemoryRecordStatusChangedEvent,
} from '../events';
import type { RuntimeEvent } from '../events';

// Agent memory management service owns memory lifecycle and recall policy.
// The repository port is supplied by the host (desktop with SQLite, or test doubles).

export interface MemoryManagementRepositoryPort {
  saveMemory(memory: MemoryRecord): MemoryRecord;
  getMemory(memoryId: string): MemoryRecord | undefined;
  listMemories(filter: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    kind?: MemoryKind;
    query?: string;
    limit?: number;
  }): MemoryRecord[];
  listSourceRefsByOwner(ownerId: string, ownerKind: 'candidate' | 'memory'): MemorySourceRef[];
  recordCaptureAttempt(attempt: MemoryManagementCaptureAttempt): MemoryManagementCaptureAttempt;
  getCaptureAttempt(captureAttemptId: string): MemoryManagementCaptureAttempt | undefined;
  listCaptureAttempts(filter?: {
    workspaceId?: string | null;
    sessionId?: string | null;
    runId?: string | null;
    status?: string;
    triggerKind?: string;
    limit?: number;
  }): MemoryManagementCaptureAttempt[];
  recordRecallTrace(trace: MemoryManagementRecallTrace): MemoryManagementRecallTrace;
}

export interface MemoryManagementCaptureAttempt {
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

export interface MemoryManagementRecallTrace {
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

export interface MemoryServiceDependencies {
  repository: MemoryManagementRepositoryPort;
  now: () => string;
  createId: (prefix: string) => string;
  emitRuntimeEvent?: (event: RuntimeEvent) => void;
}

export interface ProposeMemoryCandidateInput {
  workspaceId?: string;
  projectId?: string;
  sessionId?: string;
  runId?: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  sourceRefs: MemorySourceRef[];
  proposedBy: 'agent' | 'host' | 'user' | 'system';
}

export interface CandidateReviewInput {
  candidateId: string;
  content?: string;
  summary?: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  reviewedAt: string;
  reviewedBy?: string;
}

export interface CandidateRejectInput extends CandidateReviewInput {
  rejectionReason: string;
}

export interface MemoryStatusInput {
  memoryId: string;
  updatedAt: string;
}

export interface MemoryRecallPreviewInput {
  sessionId: string;
  runId?: string;
  workspaceId?: string;
  projectId?: string;
  query?: string;
  scopes: MemoryScope[];
  kinds?: MemoryKind[];
  limit: number;
  budget?: number;
  createdAt: string;
}

export interface MemoryService {
  proposeCandidate(input: ProposeMemoryCandidateInput): MemoryCandidate;
  listCandidates(filter: { workspaceId?: string; sessionId?: string; status?: MemoryCandidateStatus }): MemoryCandidate[];
  acceptCandidate(input: CandidateReviewInput): { candidate: MemoryCandidate; memory: MemoryRecord };
  rejectCandidate(input: CandidateRejectInput): MemoryCandidate;
  archiveCandidate(input: CandidateReviewInput): MemoryCandidate;
  listMemories(filter: { scope?: MemoryScope; projectId?: string | null; status?: MemoryRecordStatus; kind?: MemoryKind; query?: string; limit?: number }): MemoryRecord[];
  getMemory(memoryId: string): { memory?: MemoryRecord; sourceRefs: MemorySourceRef[] };
  updateMemory(input: { memoryId: string; content?: string; summary?: string; scope?: MemoryScope; kind?: MemoryKind; updatedAt: string }): MemoryRecord;
  archiveMemory(input: MemoryStatusInput): MemoryRecord;
  deleteMemory(input: MemoryStatusInput): MemoryRecord;
  disableMemory(input: MemoryStatusInput): MemoryRecord;
  enableMemory(input: MemoryStatusInput): MemoryRecord;
  listSourceRefs(memoryId: string): MemorySourceRef[];
  listAccessLogs(filter: { memoryId?: string; sessionId?: string; runId?: string; limit?: number }): MemoryAccessLog[];
  recallPreview(input: MemoryRecallPreviewInput): { request: MemoryRecallRequest; results: MemoryRecallResult[] };
}

export function createMemoryService(deps: MemoryServiceDependencies): MemoryService {
  function emit(event: RuntimeEvent): void {
    deps.emitRuntimeEvent?.(event);
  }

  function eventBase(runId: string | undefined, sessionId: string | undefined, sequence: number) {
    return {
      eventId: deps.createId('event:memory'),
      runId: runId ?? 'run:memory-management',
      ...(sessionId ? { sessionId } : {}),
      sequence,
      createdAt: deps.now(),
      source: 'memory' as const,
    };
  }

  function statusChange(memoryId: string, to: MemoryRecordStatus, updatedAt: string): MemoryRecord {
    const current = requireMemory(memoryId);
    const updated: MemoryRecord = {
      ...current,
      status: to,
      updatedAt,
      ...(to === 'deleted' ? { deletedAt: updatedAt } : {}),
      ...(to === 'active' ? { deletedAt: null, supersededById: null } : {}),
    };
    deps.repository.saveMemory(updated);
    emit(createRuntimeMemoryRecordStatusChangedEvent(eventBase(undefined, updated.sourceSessionId ?? undefined, 1), {
      memoryId,
      from: current.status,
      to,
      reason: `memory_${to}`,
    }));
    return updated;
  }

  function requireCandidate(candidateId: string): MemoryCandidate {
    const candidate = candidateFromCapture(deps.repository.getCaptureAttempt(candidateId));
    if (!candidate) {
      throw new Error(`Memory candidate not found: ${candidateId}`);
    }
    return candidate;
  }

  function recordCandidateCapture(candidate: MemoryCandidate): MemoryCandidate {
    deps.repository.recordCaptureAttempt({
      captureAttemptId: candidate.candidateId,
      runId: undefined,
      workspaceId: candidate.projectId ?? candidate.workspaceId ?? null,
      sessionId: candidate.sessionId ?? null,
      status: candidate.status,
      triggerKind: 'candidate',
      extractedCount: 1,
      rawOutput: candidate,
      createdAt: candidate.createdAt,
      completedAt: candidate.reviewedAt ?? candidate.updatedAt ?? null,
      metadata: {
        candidate: candidate as unknown as JsonObject,
        sourceRefs: candidate.sourceRefs as unknown as JsonObject[],
      },
    });
    return candidate;
  }

  function listCandidateCaptures(filter: { workspaceId?: string; sessionId?: string; status?: MemoryCandidateStatus }): MemoryCandidate[] {
    return deps.repository.listCaptureAttempts({
      workspaceId: filter.workspaceId ?? null,
      sessionId: filter.sessionId ?? null,
      status: filter.status,
      triggerKind: 'candidate',
    })
      .map(candidateFromCapture)
      .filter((candidate): candidate is MemoryCandidate => Boolean(candidate));
  }

  function saveAccessCapture(accessLog: MemoryAccessLog): MemoryAccessLog {
    deps.repository.recordCaptureAttempt({
      captureAttemptId: accessLog.accessLogId,
      runId: accessLog.runId ?? null,
      sessionId: accessLog.sessionId ?? null,
      status: 'recorded',
      triggerKind: 'access_log',
      extractedCount: 0,
      createdAt: accessLog.accessedAt,
      completedAt: accessLog.accessedAt,
      metadata: { accessLog: accessLog as unknown as JsonObject },
    });
    return accessLog;
  }

  function listAccessCaptures(filter: { memoryId?: string; sessionId?: string; runId?: string; limit?: number }): MemoryAccessLog[] {
    return deps.repository.listCaptureAttempts({
      sessionId: filter.sessionId ?? null,
      runId: filter.runId ?? null,
      triggerKind: 'access_log',
      limit: filter.limit,
    })
      .map((attempt) => attempt.metadata?.accessLog as MemoryAccessLog | undefined)
      .filter((log): log is MemoryAccessLog => Boolean(log))
      .filter((log) => !filter.memoryId || log.memoryId === filter.memoryId);
  }

  function requireMemory(memoryId: string): MemoryRecord {
    const memory = deps.repository.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    return memory;
  }

  return {
    proposeCandidate(input) {
      const policy = createDefaultMemoryPolicy({
        now: deps.now(),
        autoCaptureEnabled: true,
      });
      const decision = evaluateMemoryCandidatePolicy({
        policy,
        scope: input.scope,
        kind: input.kind,
        sourceKinds: input.sourceRefs.map((ref) => ref.kind),
        content: input.content,
      });
      if (!decision.allowed) {
        throw new Error(`Memory candidate blocked: ${decision.reason}`);
      }
      const candidateId = deps.createId('memory-candidate');
      const candidate = createMemoryCandidateDraft({
        candidateId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        scope: input.scope,
        kind: input.kind,
        content: input.content,
        sourceRefs: input.sourceRefs.map((ref) => ({ ...ref, ownerId: candidateId, ownerKind: 'candidate' })),
        proposedBy: input.proposedBy,
        riskLevel: decision.riskLevel,
        now: deps.now(),
      });
      recordCandidateCapture(candidate);
      emit(createRuntimeMemoryCandidateProposedEvent(eventBase(input.runId, input.sessionId, 1), {
        candidateId: candidate.candidateId,
        scope: candidate.scope,
        kind: candidate.kind,
        status: candidate.status,
        riskLevel: candidate.riskLevel,
        summary: candidate.summary,
        sourceRefCount: candidate.sourceRefs.length,
      }));
      return candidate;
    },
    listCandidates: listCandidateCaptures,
    acceptCandidate(input) {
      const current = requireCandidate(input.candidateId);
      const candidate: MemoryCandidate = {
        ...current,
        ...(input.content ? { content: input.content } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        status: 'accepted',
        reviewedAt: input.reviewedAt,
        reviewedBy: input.reviewedBy,
        updatedAt: input.reviewedAt,
      };
      const memoryId = deps.createId('memory');
      const sourceRefs = candidate.sourceRefs.map((ref) => ({ ...ref, sourceRefId: deps.createId('memory-source'), ownerId: memoryId, ownerKind: 'memory' as const }));
      const memory: MemoryRecord = {
        memoryId,
        scope: candidate.scope,
        projectId: candidate.scope === 'project' ? candidate.projectId ?? candidate.workspaceId ?? null : null,
        kind: candidate.kind,
        status: 'active',
        content: candidate.content,
        summary: candidate.summary,
        normalizedText: normalizeMemoryText(candidate.content),
        dedupeKey: buildDedupeKey(candidate.scope, candidate.scope === 'project' ? candidate.projectId ?? candidate.workspaceId ?? null : null, candidate.kind, candidate.content),
        source: 'manual_system',
        sourceRunId: null,
        sourceSessionId: candidate.sessionId ?? null,
        sourceMessageId: null,
        sourceToolCallId: null,
        evidence: [],
        supersededById: null,
        createdFromCandidateId: candidate.candidateId,
        createdAt: input.reviewedAt,
        updatedAt: input.reviewedAt,
        lastUsedAt: null,
        useCount: 0,
        deletedAt: null,
        metadata: {},
        sourceRefs,
        confidence: candidate.confidence,
      };
      recordCandidateCapture(candidate);
      deps.repository.saveMemory(memory);
      emit(createRuntimeMemoryCandidateAcceptedEvent(eventBase(undefined, candidate.sessionId, 1), {
        candidateId: candidate.candidateId,
        memoryId: memory.memoryId,
        reviewedAt: input.reviewedAt,
      }));
      emit(createRuntimeMemoryRecordCreatedEvent(eventBase(undefined, memory.sourceSessionId ?? undefined, 2), {
        memoryId: memory.memoryId,
        scope: memory.scope,
        kind: memory.kind,
        status: memory.status,
        summary: memory.summary ?? memory.content,
      }));
      return { candidate, memory };
    },
    rejectCandidate(input) {
      const current = requireCandidate(input.candidateId);
      const candidate = recordCandidateCapture({
        ...current,
        status: 'rejected',
        reviewedAt: input.reviewedAt,
        reviewedBy: input.reviewedBy,
        rejectionReason: input.rejectionReason,
        updatedAt: input.reviewedAt,
      });
      emit(createRuntimeMemoryCandidateRejectedEvent(eventBase(undefined, candidate.sessionId, 1), {
        candidateId: candidate.candidateId,
        rejectionReason: input.rejectionReason,
        reviewedAt: input.reviewedAt,
      }));
      return candidate;
    },
    archiveCandidate(input) {
      const current = requireCandidate(input.candidateId);
      return recordCandidateCapture({ ...current, status: 'archived', reviewedAt: input.reviewedAt, reviewedBy: input.reviewedBy, updatedAt: input.reviewedAt });
    },
    listMemories: (filter) => deps.repository.listMemories(filter),
    getMemory(memoryId) {
      return { memory: deps.repository.getMemory(memoryId), sourceRefs: deps.repository.listSourceRefsByOwner(memoryId, 'memory') };
    },
    updateMemory(input) {
      const current = requireMemory(input.memoryId);
      const scope = input.scope ?? current.scope;
      const kind = input.kind ?? current.kind;
      const content = input.content ?? current.content;
      const projectId = scope === 'project' ? current.projectId ?? null : null;
      return deps.repository.saveMemory({
        ...current,
        ...(input.content ? { content: input.content, normalizedText: normalizeMemoryText(input.content) } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
        scope,
        projectId,
        kind,
        dedupeKey: buildDedupeKey(scope, projectId, kind, content),
        updatedAt: input.updatedAt,
      });
    },
    archiveMemory: (input) => statusChange(input.memoryId, 'superseded', input.updatedAt),
    deleteMemory: (input) => statusChange(input.memoryId, 'deleted', input.updatedAt),
    disableMemory: (input) => statusChange(input.memoryId, 'deleted', input.updatedAt),
    enableMemory: (input) => statusChange(input.memoryId, 'active', input.updatedAt),
    listSourceRefs: (memoryId) => deps.repository.listSourceRefsByOwner(memoryId, 'memory'),
    listAccessLogs: listAccessCaptures,
    recallPreview(input) {
      const request: MemoryRecallRequest = {
        recallRequestId: deps.createId('memory-recall'),
        sessionId: input.sessionId,
        runId: input.runId ?? 'run:memory-preview',
        projectId: input.projectId,
        queryText: input.query ?? 'memory preview',
        requestedScopes: input.scopes,
        requestedKinds: input.kinds,
        maxResults: input.limit,
        createdAt: input.createdAt,
        metadata: {},
      };
      emit(createRuntimeMemoryRecallRequestedEvent(eventBase(input.runId, input.sessionId, 1), {
        recallRequestId: request.recallRequestId,
        scopes: request.requestedScopes,
        kinds: request.requestedKinds,
        limit: request.maxResults,
      }));
      const records = input.scopes.flatMap((scope) => deps.repository.listMemories({
        scope,
        projectId: scope === 'project' ? input.projectId ?? null : null,
        status: 'active',
        query: input.query,
      }));
      const results = selectMemoryRecallResults({
        recallRequestId: request.recallRequestId,
        records,
        scopes: input.scopes,
        kinds: input.kinds,
        projectId: input.projectId,
        query: input.query,
        limit: input.limit,
        budget: input.budget,
        now: input.createdAt,
      });
      results.forEach((result) => {
        saveAccessCapture({
          accessLogId: deps.createId('memory-access'),
          memoryId: result.memoryId,
          sessionId: input.sessionId,
          runId: input.runId,
          recallRequestId: request.recallRequestId,
          accessKind: result.selectedForContext ? 'selected_for_context' : 'recalled',
          accessedAt: input.createdAt,
          selectedForContext: result.selectedForContext,
        });
        const recalled = deps.repository.getMemory(result.memoryId);
        if (recalled) {
          deps.repository.saveMemory({
            ...recalled,
            lastUsedAt: input.createdAt,
            useCount: (recalled.useCount ?? 0) + 1,
            updatedAt: recalled.updatedAt,
          });
        }
        emit(createRuntimeMemoryAccessRecordedEvent(eventBase(input.runId, input.sessionId, 2), {
          accessLogId: deps.createId('memory-access-event'),
          memoryId: result.memoryId,
          accessKind: result.selectedForContext ? 'selected_for_context' : 'recalled',
          selectedForContext: result.selectedForContext,
        }));
      });
      deps.repository.recordRecallTrace({
        recallTraceId: request.recallRequestId,
        runId: request.runId,
        sessionId: request.sessionId,
        projectId: request.projectId ?? null,
        queryText: request.queryText,
        request,
        results,
        createdAt: request.createdAt,
        metadata: {},
      });
      emit(createRuntimeMemoryRecallCompletedEvent(eventBase(input.runId, input.sessionId, 3), {
        recallRequestId: request.recallRequestId,
        resultCount: results.length,
        selectedCount: results.filter((result) => result.selectedForContext).length,
      }));
      return { request, results };
    },
  };
}

function normalizeMemoryText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim() || 'memory';
}

function buildDedupeKey(scope: MemoryScope, projectId: string | null | undefined, kind: MemoryKind, content: string): string {
  return `${scope}:${projectId ?? ''}:${kind}:${normalizeMemoryText(content)}`;
}

function candidateFromCapture(attempt: MemoryManagementCaptureAttempt | undefined): MemoryCandidate | undefined {
  const candidate = attempt?.metadata?.candidate as MemoryCandidate | undefined;
  return candidate?.candidateId ? candidate : undefined;
}

