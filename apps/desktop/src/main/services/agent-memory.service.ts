import type { MemoryRepository } from '@megumi/db';
import {
  createDefaultMemoryPolicy,
  createMemoryCandidateDraft,
  evaluateMemoryCandidatePolicy,
  selectMemoryRecallResults,
} from '@megumi/memory';
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
  MemorySettings,
  MemorySourceRef,
} from '@megumi/shared/memory-contracts';
import {
  createRuntimeMemoryAccessRecordedEvent,
  createRuntimeMemoryCandidateAcceptedEvent,
  createRuntimeMemoryCandidateProposedEvent,
  createRuntimeMemoryCandidateRejectedEvent,
  createRuntimeMemoryRecallCompletedEvent,
  createRuntimeMemoryRecallRequestedEvent,
  createRuntimeMemoryRecordCreatedEvent,
  createRuntimeMemoryRecordStatusChangedEvent,
} from '@megumi/shared/runtime-event-factory';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

export interface AgentMemoryServiceDependencies {
  repository: MemoryRepository;
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

export interface AgentMemoryService {
  getSettings(workspaceId: string): MemorySettings;
  updateSettings(settings: MemorySettings): MemorySettings;
  proposeCandidate(input: ProposeMemoryCandidateInput): MemoryCandidate;
  listCandidates(filter: { workspaceId?: string; sessionId?: string; status?: MemoryCandidateStatus }): MemoryCandidate[];
  acceptCandidate(input: CandidateReviewInput): { candidate: MemoryCandidate; memory: MemoryRecord };
  rejectCandidate(input: CandidateRejectInput): MemoryCandidate;
  archiveCandidate(input: CandidateReviewInput): MemoryCandidate;
  listMemories(filter: { workspaceId?: string; projectId?: string; sessionId?: string; status?: MemoryRecordStatus; query?: string }): MemoryRecord[];
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

export function createAgentMemoryService(deps: AgentMemoryServiceDependencies): AgentMemoryService {
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

  function getSettings(workspaceId: string): MemorySettings {
    return deps.repository.getSettings(workspaceId) ?? {
      workspaceId,
      autoCaptureEnabled: true,
      defaultCandidateReviewMode: 'manual',
      updatedAt: deps.now(),
    };
  }

  function statusChange(memoryId: string, to: MemoryRecordStatus, updatedAt: string): MemoryRecord {
    const current = requireMemory(memoryId);
    const updated: MemoryRecord = {
      ...current,
      status: to,
      updatedAt,
      ...(to === 'deleted' ? { deletedAt: updatedAt, content: '', summary: 'Deleted memory tombstone.' } : {}),
      ...(to === 'disabled' ? { disabledAt: updatedAt } : {}),
      ...(to === 'active' ? { disabledAt: undefined } : {}),
    };
    deps.repository.saveMemory(updated);
    emit(createRuntimeMemoryRecordStatusChangedEvent(eventBase(undefined, updated.sessionId, 1), {
      memoryId,
      from: current.status,
      to,
      reason: `memory_${to}`,
    }));
    return updated;
  }

  function requireCandidate(candidateId: string): MemoryCandidate {
    const candidate = deps.repository.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`Memory candidate not found: ${candidateId}`);
    }
    return candidate;
  }

  function requireMemory(memoryId: string): MemoryRecord {
    const memory = deps.repository.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    return memory;
  }

  return {
    getSettings,
    updateSettings: (settings) => deps.repository.saveSettings(settings),
    proposeCandidate(input) {
      const settings = input.workspaceId ? getSettings(input.workspaceId) : undefined;
      const policy = createDefaultMemoryPolicy({
        now: deps.now(),
        autoCaptureEnabled: settings?.autoCaptureEnabled ?? true,
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
      deps.repository.saveCandidate(candidate);
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
    listCandidates: (filter) => deps.repository.listCandidates(filter),
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
        workspaceId: candidate.workspaceId,
        projectId: candidate.projectId,
        sessionId: candidate.sessionId,
        scope: candidate.scope,
        kind: candidate.kind,
        content: candidate.content,
        summary: candidate.summary,
        sourceRefs,
        confidence: candidate.confidence,
        status: 'active',
        createdFromCandidateId: candidate.candidateId,
        createdAt: input.reviewedAt,
        updatedAt: input.reviewedAt,
        accessCount: 0,
      };
      deps.repository.saveCandidate(candidate);
      deps.repository.saveMemory(memory);
      emit(createRuntimeMemoryCandidateAcceptedEvent(eventBase(undefined, candidate.sessionId, 1), {
        candidateId: candidate.candidateId,
        memoryId: memory.memoryId,
        reviewedAt: input.reviewedAt,
      }));
      emit(createRuntimeMemoryRecordCreatedEvent(eventBase(undefined, memory.sessionId, 2), {
        memoryId: memory.memoryId,
        scope: memory.scope,
        kind: memory.kind,
        status: memory.status,
        summary: memory.summary,
      }));
      return { candidate, memory };
    },
    rejectCandidate(input) {
      const current = requireCandidate(input.candidateId);
      const candidate = deps.repository.saveCandidate({
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
      return deps.repository.saveCandidate({ ...current, status: 'archived', reviewedAt: input.reviewedAt, reviewedBy: input.reviewedBy, updatedAt: input.reviewedAt });
    },
    listMemories: (filter) => deps.repository.listMemories(filter),
    getMemory(memoryId) {
      return { memory: deps.repository.getMemory(memoryId), sourceRefs: deps.repository.listSourceRefsByOwner(memoryId, 'memory') };
    },
    updateMemory(input) {
      const current = requireMemory(input.memoryId);
      return deps.repository.saveMemory({
        ...current,
        ...(input.content ? { content: input.content } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        updatedAt: input.updatedAt,
      });
    },
    archiveMemory: (input) => statusChange(input.memoryId, 'archived', input.updatedAt),
    deleteMemory: (input) => statusChange(input.memoryId, 'deleted', input.updatedAt),
    disableMemory: (input) => statusChange(input.memoryId, 'disabled', input.updatedAt),
    enableMemory: (input) => statusChange(input.memoryId, 'active', input.updatedAt),
    listSourceRefs: (memoryId) => deps.repository.listSourceRefsByOwner(memoryId, 'memory'),
    listAccessLogs: (filter) => deps.repository.listAccessLogs(filter),
    recallPreview(input) {
      const request: MemoryRecallRequest = {
        recallRequestId: deps.createId('memory-recall'),
        sessionId: input.sessionId,
        runId: input.runId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        query: input.query,
        scopes: input.scopes,
        kinds: input.kinds,
        limit: input.limit,
        budget: input.budget,
        createdAt: input.createdAt,
      };
      emit(createRuntimeMemoryRecallRequestedEvent(eventBase(input.runId, input.sessionId, 1), {
        recallRequestId: request.recallRequestId,
        scopes: request.scopes,
        kinds: request.kinds,
        limit: request.limit,
      }));
      const records = deps.repository.listMemories({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        status: 'active',
        query: input.query,
      });
      const results = selectMemoryRecallResults({
        recallRequestId: request.recallRequestId,
        records,
        scopes: input.scopes,
        kinds: input.kinds,
        query: input.query,
        limit: input.limit,
        budget: input.budget,
        now: input.createdAt,
      });
      deps.repository.saveRecallRequest(request);
      results.forEach((result) => {
        deps.repository.saveRecallResult(result);
        deps.repository.saveAccessLog({
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
            lastAccessedAt: input.createdAt,
            accessCount: (recalled.accessCount ?? 0) + 1,
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
      emit(createRuntimeMemoryRecallCompletedEvent(eventBase(input.runId, input.sessionId, 3), {
        recallRequestId: request.recallRequestId,
        resultCount: results.length,
        selectedCount: results.filter((result) => result.selectedForContext).length,
      }));
      return { request, results };
    },
  };
}
