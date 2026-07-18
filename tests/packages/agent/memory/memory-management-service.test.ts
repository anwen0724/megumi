import { describe, expect, it } from 'vitest';
import {
  createMemoryService,
  type MemoryManagementCaptureAttempt,
  type MemoryManagementRepositoryPort,
  type MemoryManagementRecallTrace,
} from '@megumi/agent/memory';
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
} from '@megumi/agent/memory/legacy-contracts/memory-contracts';
import type { RuntimeEvent } from '@megumi/agent/events';
import type { JsonValue } from '@megumi/agent/memory/legacy-contracts/memory-json';

const now = '2026-05-16T00:00:00.000Z';

function createInMemoryRepository(): MemoryManagementRepositoryPort {
  const candidates = new Map<string, MemoryCandidate>();
  const memories = new Map<string, MemoryRecord>();
  const sourceRefsByOwner = new Map<string, MemorySourceRef[]>();
  const accessLogs: MemoryAccessLog[] = [];
  const recallRequests: MemoryRecallRequest[] = [];
  const recallResults: MemoryRecallResult[] = [];

  return {
    saveMemory(memory) { memories.set(memory.memoryId, memory); return memory; },
    getMemory(memoryId) { return memories.get(memoryId); },
    listMemories(filter) {
      return [...memories.values()].filter((m) => {
        if (filter.scope !== undefined && m.scope !== filter.scope) return false;
        if (filter.projectId !== undefined && m.projectId !== filter.projectId) return false;
        if (filter.status !== undefined && m.status !== filter.status) return false;
        if (filter.kind !== undefined && m.kind !== filter.kind) return false;
        return true;
      });
    },
    listSourceRefsByOwner(ownerId, _ownerKind) {
      return sourceRefsByOwner.get(ownerId) ?? [];
    },
    recordCaptureAttempt(attempt) {
      if (attempt.triggerKind === 'candidate') {
        const candidate = attempt.metadata?.candidate as MemoryCandidate | undefined;
        if (candidate) {
          candidates.set(candidate.candidateId, candidate);
        }
      }
      if (attempt.triggerKind === 'access_log') {
        const accessLog = attempt.metadata?.accessLog as MemoryAccessLog | undefined;
        if (accessLog) {
          accessLogs.push(accessLog);
        }
      }
      return attempt;
    },
    getCaptureAttempt(captureAttemptId) {
      const candidate = candidates.get(captureAttemptId);
      return candidate
        ? {
            captureAttemptId,
            workspaceId: candidate.projectId ?? candidate.workspaceId ?? null,
            sessionId: candidate.sessionId ?? null,
            status: candidate.status,
            triggerKind: 'candidate',
            createdAt: candidate.createdAt,
            metadata: { candidate: candidate as unknown as JsonValue },
          }
        : undefined;
    },
    listCaptureAttempts(filter = {}) {
      if (filter.triggerKind === 'candidate') {
        return [...candidates.values()]
          .filter((candidate) => {
            if (filter.workspaceId !== undefined && filter.workspaceId !== null && candidate.workspaceId !== filter.workspaceId && candidate.projectId !== filter.workspaceId) return false;
            if (filter.sessionId !== undefined && filter.sessionId !== null && candidate.sessionId !== filter.sessionId) return false;
            if (filter.status !== undefined && candidate.status !== filter.status) return false;
            return true;
          })
          .map((candidate) => ({
            captureAttemptId: candidate.candidateId,
            workspaceId: candidate.projectId ?? candidate.workspaceId ?? null,
            sessionId: candidate.sessionId ?? null,
            status: candidate.status,
            triggerKind: 'candidate',
            createdAt: candidate.createdAt,
            metadata: { candidate: candidate as unknown as JsonValue },
          }));
      }
      if (filter.triggerKind === 'access_log') {
        return accessLogs.map((accessLog) => ({
          captureAttemptId: accessLog.accessLogId,
          runId: accessLog.runId ?? null,
          sessionId: accessLog.sessionId ?? null,
          status: 'recorded',
          triggerKind: 'access_log',
          createdAt: accessLog.accessedAt,
          metadata: { accessLog: accessLog as unknown as JsonValue },
        }));
      }
      return [];
    },
    recordRecallTrace(trace: MemoryManagementRecallTrace): MemoryManagementRecallTrace {
      recallRequests.push(trace.request);
      recallResults.push(...trace.results);
      return trace;
    },
  };
}

function createService() {
  const repository = createInMemoryRepository();
  const events: RuntimeEvent[] = [];
  const service = createMemoryService({
    repository,
    now: () => now,
    createId: (prefix) => `${prefix}:1`,
    emitRuntimeEvent: (event) => events.push(event),
  });
  return { service, repository, events };
}

describe('MemoryService', () => {
  it('creates settings and candidate-first records through user review', () => {
    const { service, events } = createService();
    const candidate = service.proposeCandidate({
      workspaceId: 'workspace:1',
      projectId: 'project:1',
      sessionId: 'session:1',
      runId: 'run:1',
      scope: 'project',
      kind: 'decision',
      content: '大功能先写 spec，再写 plan。',
      sourceRefs: [
        {
          sourceRefId: 'memory-source:1',
          ownerId: 'source-placeholder',
          ownerKind: 'candidate',
          kind: 'message',
          refId: 'message:1',
          excerptPreview: '安全摘要',
          createdAt: now,
        },
      ],
      proposedBy: 'agent',
    });

    expect(candidate.status).toBe('proposed');
    expect(candidate.scope).toBe('project');
    expect(candidate.sourceRefs[0]).toMatchObject({
      ownerId: candidate.candidateId,
      ownerKind: 'candidate',
    });
    expect(service.listCandidates({ workspaceId: 'workspace:1', status: 'proposed' })).toHaveLength(1);

    const accepted = service.acceptCandidate({
      candidateId: candidate.candidateId,
      reviewedAt: now,
      reviewedBy: 'user',
    });

    expect(accepted.candidate.status).toBe('accepted');
    expect(accepted.memory.status).toBe('active');
    expect(service.listMemories({ scope: 'project', projectId: 'project:1', status: 'active' })).toHaveLength(1);
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'memory.candidate.proposed',
      'memory.candidate.accepted',
      'memory.record.created',
    ]));
    expect(JSON.stringify(events)).not.toContain('raw full prompt');
  });

  it('updates lifecycle and recall preview with access logs', () => {
    const { service } = createService();
    const candidate = service.proposeCandidate({
      workspaceId: 'workspace:1',
      projectId: 'project:1',
      sessionId: 'session:1',
      scope: 'project',
      kind: 'constraint',
      content: 'IPC channel stays in request.meta.channel.',
      sourceRefs: [],
      proposedBy: 'user',
    });
    const { memory } = service.acceptCandidate({ candidateId: candidate.candidateId, reviewedAt: now });

    const disabled = service.disableMemory({ memoryId: memory.memoryId, updatedAt: now });
    expect(disabled).toMatchObject({ status: 'deleted', deletedAt: now });
    expect(service.enableMemory({ memoryId: memory.memoryId, updatedAt: now }).status).toBe('active');
    expect(service.archiveMemory({ memoryId: memory.memoryId, updatedAt: now }).status).toBe('superseded');
    expect(service.enableMemory({ memoryId: memory.memoryId, updatedAt: now }).status).toBe('active');
    const preview = service.recallPreview({
      sessionId: 'session:1',
      projectId: 'project:1',
      query: 'ipc channel',
      scopes: ['project'],
      kinds: ['constraint'],
      limit: 5,
      createdAt: now,
    });

    expect(preview.results).toHaveLength(1);
    expect(service.listAccessLogs({ memoryId: memory.memoryId })).toHaveLength(1);
    expect(service.getMemory(memory.memoryId).memory).toMatchObject({
      lastUsedAt: now,
      useCount: 1,
    });
    expect(service.deleteMemory({ memoryId: memory.memoryId, updatedAt: now }).status).toBe('deleted');
    expect(service.recallPreview({
      sessionId: 'session:1',
      projectId: 'project:1',
      query: 'ipc channel',
      scopes: ['project'],
      limit: 5,
      createdAt: now,
    }).results).toHaveLength(0);
  });

  it('applies candidate edits before accepting memory records', () => {
    const { service } = createService();
    const candidate = service.proposeCandidate({
      workspaceId: 'workspace:1',
      projectId: 'project:1',
      sessionId: 'session:1',
      scope: 'project',
      kind: 'decision',
      content: 'old candidate content',
      sourceRefs: [],
      proposedBy: 'agent',
    });

    const { memory } = service.acceptCandidate({
      candidateId: candidate.candidateId,
      content: 'edited candidate content',
      summary: 'edited summary',
      kind: 'constraint',
      reviewedAt: now,
    });

    expect(memory).toMatchObject({
      content: 'edited candidate content',
      summary: 'edited summary',
      kind: 'constraint',
    });
    expect(service.getMemory(memory.memoryId).memory).toMatchObject({
      content: 'edited candidate content',
      summary: 'edited summary',
      kind: 'constraint',
    });
  });
});
