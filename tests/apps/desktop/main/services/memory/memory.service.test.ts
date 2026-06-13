import { describe, expect, it } from 'vitest';
import { createMemoryService } from '@megumi/desktop/main/services/memory/memory.service';
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
      expect(service.getSettings()).toMatchObject({
        autoCaptureEnabled: false,
        defaultCandidateReviewMode: 'manual',
      });
      service.updateSettings({
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: now,
      });

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
    } finally {
      database.close();
    }
  });

  it('updates lifecycle and recall preview with access logs', () => {
    const { service, database } = createService();
    try {
      service.updateSettings({
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: now,
      });
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
    } finally {
      database.close();
    }
  });

  it('applies candidate edits before accepting memory records', () => {
    const { service, database } = createService();
    try {
      service.updateSettings({
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: now,
      });
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
    } finally {
      database.close();
    }
  });
});



