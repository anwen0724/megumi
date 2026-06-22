import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { MemoryRepository } from '@megumi/coding-agent/persistence/repos/memory.repo';
import type {
  MemoryAccessLog,
  MemoryAuditLog,
  MemoryCandidate,
  MemoryMarkdownMirror,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemorySourceRef,
} from '@megumi/shared/memory';

const now = '2026-06-12T00:00:00.000Z';
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

function memoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    memoryId: 'memory:1',
    scope: 'project',
    projectId: 'project:1',
    kind: 'decision',
    status: 'active',
    content: 'Use Vitest for unit tests.',
    summary: 'Testing framework decision',
    normalizedText: 'use vitest for unit tests',
    dedupeKey: 'project:project:1:decision:use-vitest',
    source: 'capture',
    sourceRunId: 'run:1',
    sourceSessionId: 'session:1',
    sourceMessageId: 'message:1',
    sourceToolCallId: 'tool-call:1',
    evidence: [
      {
        kind: 'message',
        runId: 'run:1',
        sessionId: 'session:1',
        messageId: 'message:1',
        metadata: {},
      },
    ],
    supersededById: null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    useCount: 2,
    deletedAt: null,
    metadata: { source: 'test' },
    ...overrides,
  };
}

describe('MemoryRepository', () => {
  it('round-trips 18.02 memory records and filters active project memory', () => {
    const repo = createRepository();
    const memory = memoryRecord();

    expect(repo.saveMemory(memory)).toEqual(memory);
    expect(repo.getMemory(memory.memoryId)).toEqual(memory);
    expect(repo.listMemories({
      scope: 'project',
      projectId: 'project:1',
      status: 'active',
      kind: 'decision',
    })).toEqual([memory]);
    expect(repo.findActiveMemoryByDedupeKey({
      scope: 'project',
      projectId: 'project:1',
      kind: 'decision',
      dedupeKey: memory.dedupeKey,
    })).toEqual(memory);
  });

  it('validates long-term memory scope and project ownership before saving', () => {
    const repo = createRepository();

    expect(() => repo.saveMemory(memoryRecord({
      scope: 'user',
      projectId: 'project:1',
    }))).toThrow();
    expect(() => repo.saveMemory({
      ...memoryRecord(),
      scope: 'session',
      projectId: null,
    } as unknown as MemoryRecord)).toThrow();
    expect(() => repo.saveMemory({
      ...memoryRecord(),
      scope: 'workspace',
    } as unknown as MemoryRecord)).toThrow();
  });

  it('round-trips markdown mirror state', () => {
    const repo = createRepository();
    const mirror: MemoryMarkdownMirror = {
      mirrorId: 'mirror:1',
      scope: 'project',
      projectId: 'project:1',
      filePath: 'C:/repo/.megumi/memory/projects/project-1/memory.md',
      status: 'dirty',
      lastImportedAt: now,
      lastExportedAt: now,
      contentHash: 'hash:1',
      lastError: null,
      metadata: { source: 'test' },
    };

    repo.saveMarkdownMirror(mirror);

    expect(repo.getMarkdownMirror(mirror.mirrorId)).toEqual(mirror);
    expect(repo.listMarkdownMirrors({ scope: 'project', projectId: 'project:1', status: 'dirty' })).toEqual([mirror]);
  });

  it('round-trips recall request and result traces with new contracts', () => {
    const repo = createRepository();
    const request: MemoryRecallRequest = {
      recallRequestId: 'memory-recall:1',
      runId: 'run:1',
      sessionId: 'session:1',
      projectId: 'project:1',
      queryText: 'How should tests be written?',
      requestedScopes: ['user', 'project'],
      requestedKinds: ['decision'],
      maxResults: 8,
      createdAt: now,
      metadata: { source: 'test' },
    };
    const result: MemoryRecallResult = {
      recallResultId: 'memory-recall-result:1',
      recallRequestId: request.recallRequestId,
      memoryId: 'memory:1',
      score: 0.82,
      rank: 1,
      selectedForContext: true,
      reason: 'query_match',
      createdAt: now,
      metadata: {},
    };

    expect(repo.saveRecallRequest(request)).toEqual(request);
    expect(repo.saveRecallResult(result)).toEqual(result);
    expect(repo.listRecallResultsByRequest(request.recallRequestId)).toEqual([result]);
  });

  it('keeps candidate, access, and audit compatibility without session scoped records', () => {
    const repo = createRepository();
    const candidate: MemoryCandidate = {
      candidateId: 'memory-candidate:1',
      projectId: 'project:1',
      sessionId: 'session:1',
      scope: 'project',
      kind: 'decision',
      content: 'Use spec before implementation.',
      summary: 'Spec-first decision.',
      sourceRefs: [sourceRef('memory-candidate:1', 'candidate')],
      confidence: 0.9,
      riskLevel: 'low',
      status: 'proposed',
      proposedBy: 'agent',
      createdAt: now,
    };
    const access: MemoryAccessLog = {
      accessLogId: 'memory-access:1',
      memoryId: 'memory:1',
      sessionId: 'session:1',
      recallRequestId: 'memory-recall:1',
      accessKind: 'selected_for_context',
      accessedAt: now,
      selectedForContext: true,
    };
    const audit: MemoryAuditLog = {
      auditId: 'memory-audit:1',
      targetKind: 'memory',
      targetId: 'memory:1',
      operation: 'memory_created',
      actorKind: 'user',
      reason: 'accepted candidate',
      beforeState: null,
      afterState: { scope: 'project', kind: 'decision', status: 'active' },
      createdAt: now,
      metadata: {},
    };

    expect(repo.saveCandidate(candidate).scope).toBe('project');
    expect(repo.listCandidates({ sessionId: 'session:1', status: 'proposed' })).toEqual([candidate]);
    expect(repo.saveAccessLog(access)).toEqual(access);
    expect(repo.listAccessLogs({ memoryId: 'memory:1' })).toEqual([access]);
    expect(repo.saveAuditLog(audit)).toEqual(audit);
    expect(repo.listAuditLogs({ targetKind: 'memory', targetId: 'memory:1' })).toEqual([audit]);
  });
});
