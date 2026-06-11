import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/db/connection';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { MemoryRepository } from '@megumi/db/repos/memory.repo';
import type {
  MemoryAccessLog,
  MemoryAuditLog,
  MemoryCandidate,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemorySettings,
  MemorySourceRef,
} from '@megumi/shared/memory';

const now = '2026-05-16T00:00:00.000Z';
let database: MegumiDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function createRepository(): MemoryRepository {
  database = createDatabase(':memory:');
  migrateDatabase(database);
  return new MemoryRepository(database);
}

function sourceRef(ownerId: string, ownerKind: 'candidate' | 'memory'): MemorySourceRef {
  return {
    sourceRefId: `memory-source:${ownerId}`,
    ownerId,
    ownerKind,
    kind: 'message',
    refId: 'message:1',
    label: 'safe source',
    excerptPreview: 'safe preview',
    createdAt: now,
  };
}

describe('MemoryRepository', () => {
  it('saves candidates records source refs settings recall access and audit records', () => {
    const repo = createRepository();
    const candidate: MemoryCandidate = {
      candidateId: 'memory-candidate:1',
      workspaceId: 'workspace:1',
      scope: 'workspace',
      kind: 'workflow',
      content: 'Use spec before plan.',
      summary: 'Spec first workflow.',
      sourceRefs: [sourceRef('memory-candidate:1', 'candidate')],
      confidence: 0.9,
      riskLevel: 'low',
      status: 'proposed',
      proposedBy: 'agent',
      createdAt: now,
    };
    const memory: MemoryRecord = {
      memoryId: 'memory:1',
      workspaceId: 'workspace:1',
      scope: 'workspace',
      kind: 'workflow',
      content: 'Use spec before plan.',
      summary: 'Spec first workflow.',
      sourceRefs: [sourceRef('memory:1', 'memory')],
      confidence: 0.9,
      status: 'active',
      createdFromCandidateId: candidate.candidateId,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };
    const settings: MemorySettings = {
      workspaceId: 'workspace:1',
      autoCaptureEnabled: true,
      defaultCandidateReviewMode: 'manual',
      updatedAt: now,
    };
    const request: MemoryRecallRequest = {
      recallRequestId: 'memory-recall:1',
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      query: 'spec',
      scopes: ['workspace'],
      kinds: ['workflow'],
      limit: 5,
      createdAt: now,
    };
    const result: MemoryRecallResult = {
      recallResultId: 'memory-recall-result:1',
      recallRequestId: request.recallRequestId,
      memoryId: memory.memoryId,
      scope: memory.scope,
      kind: memory.kind,
      summary: memory.summary,
      contentPreview: memory.content,
      relevanceScore: 0.9,
      confidence: 0.9,
      sourceRefs: memory.sourceRefs,
      recallReason: 'query_match',
      tokenEstimate: 6,
      selectedForContext: true,
      createdAt: now,
    };
    const access: MemoryAccessLog = {
      accessLogId: 'memory-access:1',
      memoryId: memory.memoryId,
      sessionId: 'session:1',
      recallRequestId: request.recallRequestId,
      accessKind: 'selected_for_context',
      accessedAt: now,
      selectedForContext: true,
    };
    const audit: MemoryAuditLog = {
      auditLogId: 'memory-audit:1',
      targetKind: 'memory',
      targetId: memory.memoryId,
      operation: 'memory_created',
      actor: 'user',
      createdAt: now,
      summary: 'accepted candidate',
    };

    expect(repo.saveCandidate(candidate).candidateId).toBe(candidate.candidateId);
    expect(repo.saveMemory(memory).memoryId).toBe(memory.memoryId);
    expect(repo.saveSettings(settings).workspaceId).toBe(settings.workspaceId);
    expect(repo.saveRecallRequest(request).recallRequestId).toBe(request.recallRequestId);
    expect(repo.saveRecallResult(result).recallResultId).toBe(result.recallResultId);
    expect(repo.saveAccessLog(access).accessLogId).toBe(access.accessLogId);
    expect(repo.saveAuditLog(audit).auditLogId).toBe(audit.auditLogId);

    expect(repo.getCandidate(candidate.candidateId)?.status).toBe('proposed');
    expect(repo.listCandidates({ workspaceId: 'workspace:1', status: 'proposed' })).toHaveLength(1);
    expect(repo.getMemory(memory.memoryId)?.status).toBe('active');
    expect(repo.listMemories({ workspaceId: 'workspace:1', status: 'active' })).toHaveLength(1);
    expect(repo.listSourceRefsByOwner(memory.memoryId, 'memory')).toHaveLength(1);
    expect(repo.getSettings('workspace:1')?.autoCaptureEnabled).toBe(true);
    expect(repo.listRecallResultsByRequest(request.recallRequestId)).toHaveLength(1);
    expect(repo.listAccessLogs({ memoryId: memory.memoryId })).toHaveLength(1);
    expect(repo.listAuditLogs({ targetKind: 'memory', targetId: memory.memoryId })).toHaveLength(1);
  });
});

