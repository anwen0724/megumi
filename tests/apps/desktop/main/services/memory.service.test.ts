import { describe, expect, it } from 'vitest';
import { createMemoryService } from '../../../../../apps/desktop/src/main/services/memory.service';
import { createDatabase } from '@megumi/db/connection';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { MemoryRepository } from '@megumi/db/repos/memory.repo';
import type { RuntimeEvent } from '@megumi/shared/runtime';

const now = '2026-05-16T00:00:00.000Z';

function createService() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const repository = new MemoryRepository(database);
  const events: RuntimeEvent[] = [];
  const service = createMemoryService({
    repository,
    now: () => now,
    createId: (prefix) => `${prefix}:1`,
    emitRuntimeEvent: (event) => events.push(event),
  });
  return { service, database, events };
}

describe('MemoryService', () => {
  it('creates settings and candidate-first records through user review', () => {
    const { service, database, events } = createService();
    try {
      expect(service.getSettings('workspace:1')).toMatchObject({
        workspaceId: 'workspace:1',
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
      });

      const candidate = service.proposeCandidate({
        workspaceId: 'workspace:1',
        sessionId: 'session:1',
        runId: 'run:1',
        scope: 'workspace',
        kind: 'workflow',
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
      expect(service.listMemories({ workspaceId: 'workspace:1', status: 'active' })).toHaveLength(1);
      expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
        'memory.candidate.proposed',
        'memory.candidate.accepted',
        'memory.record.created',
      ]));
      expect(JSON.stringify(events)).not.toContain('raw full prompt');
    } finally {
      database.close();
    }
  });

  it('updates lifecycle and recall preview with access logs', () => {
    const { service, database } = createService();
    try {
      const candidate = service.proposeCandidate({
        workspaceId: 'workspace:1',
        sessionId: 'session:1',
        scope: 'workspace',
        kind: 'constraint',
        content: 'IPC channel stays in request.meta.channel.',
        sourceRefs: [],
        proposedBy: 'user',
      });
      const { memory } = service.acceptCandidate({ candidateId: candidate.candidateId, reviewedAt: now });

      expect(service.disableMemory({ memoryId: memory.memoryId, updatedAt: now }).status).toBe('disabled');
      expect(service.enableMemory({ memoryId: memory.memoryId, updatedAt: now }).status).toBe('active');
      const preview = service.recallPreview({
        sessionId: 'session:1',
        workspaceId: 'workspace:1',
        query: 'ipc channel',
        scopes: ['workspace'],
        kinds: ['constraint'],
        limit: 5,
        createdAt: now,
      });

      expect(preview.results).toHaveLength(1);
      expect(service.listAccessLogs({ memoryId: memory.memoryId })).toHaveLength(1);
      expect(service.getMemory(memory.memoryId).memory).toMatchObject({
        lastAccessedAt: now,
        accessCount: 1,
      });
      expect(service.deleteMemory({ memoryId: memory.memoryId, updatedAt: now }).status).toBe('deleted');
      expect(service.recallPreview({
        sessionId: 'session:1',
        workspaceId: 'workspace:1',
        query: 'ipc channel',
        scopes: ['workspace'],
        limit: 5,
        createdAt: now,
      }).results).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it('applies candidate edits before accepting memory records', () => {
    const { service, database } = createService();
    try {
      const candidate = service.proposeCandidate({
        workspaceId: 'workspace:1',
        sessionId: 'session:1',
        scope: 'workspace',
        kind: 'workflow',
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
    } finally {
      database.close();
    }
  });
});

