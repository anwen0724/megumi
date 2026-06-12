import { describe, expect, it } from 'vitest';

import {
  MEMORY_AUDIT_OPERATIONS,
  MEMORY_KINDS,
  MEMORY_MARKDOWN_MIRROR_STATUSES,
  MEMORY_RECORD_SOURCES,
  MEMORY_RECORD_STATUSES,
  MEMORY_SCOPES,
  MemoryAuditLogSchema,
  MemoryMarkdownMirrorSchema,
  MemoryRecallRequestSchema,
  MemoryRecallResultSchema,
  MemoryRecallSnapshotSchema,
  MemoryRecordSchema,
  MemoryScopeSchema,
} from '@megumi/shared/memory';

describe('memory shared contracts', () => {
  it('exposes only long-term memory scopes from the 18.02 spec', () => {
    expect(MEMORY_SCOPES).toEqual(['user', 'project']);
    expect(MemoryScopeSchema.safeParse('user').success).toBe(true);
    expect(MemoryScopeSchema.safeParse('project').success).toBe(true);
    expect(MemoryScopeSchema.safeParse('session').success).toBe(false);
    expect(MemoryScopeSchema.safeParse('workspace').success).toBe(false);
  });

  it('exposes only long-term memory kinds from the 18.02 spec', () => {
    expect(MEMORY_KINDS).toEqual(['preference', 'constraint', 'fact', 'decision']);
    expect(MemoryRecordSchema.safeParse(validMemoryRecord({ kind: 'fact' })).success).toBe(true);
    expect(MemoryRecordSchema.safeParse(validMemoryRecord({ kind: 'project_fact' })).success).toBe(false);
    expect(MemoryRecordSchema.safeParse(validMemoryRecord({ kind: 'workflow' })).success).toBe(false);
  });

  it('exposes only 18.02 record lifecycle statuses', () => {
    expect(MEMORY_RECORD_STATUSES).toEqual(['active', 'superseded', 'deleted']);
    expect(MemoryRecordSchema.safeParse(validMemoryRecord({ status: 'active' })).success).toBe(true);
    expect(MemoryRecordSchema.safeParse(validMemoryRecord({ status: 'superseded' })).success).toBe(true);
    expect(MemoryRecordSchema.safeParse(validMemoryRecord({ status: 'deleted' })).success).toBe(true);
    expect(MemoryRecordSchema.safeParse(validMemoryRecord({ status: 'archived' })).success).toBe(false);
    expect(MemoryRecordSchema.safeParse(validMemoryRecord({ status: 'disabled' })).success).toBe(false);
  });

  it('parses a runtime memory record with source, evidence, dedupe, and use metadata', () => {
    const result = MemoryRecordSchema.safeParse(validMemoryRecord());

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.scope).toBe('project');
    expect(result.data.kind).toBe('decision');
    expect(result.data.normalizedText).toBe('use vitest for unit tests');
    expect(result.data.source).toBe('capture');
    expect(result.data.evidence).toEqual([
      {
        kind: 'message',
        runId: 'run-1',
        sessionId: 'session-1',
        messageId: 'message-1',
        metadata: {},
      },
    ]);
    expect(result.data.useCount).toBe(2);
  });

  it('rejects session-scoped long-term memory records', () => {
    const result = MemoryRecordSchema.safeParse(
      validMemoryRecord({
        scope: 'session',
        projectId: null,
        sourceSessionId: 'session-1',
      }),
    );

    expect(result.success).toBe(false);
  });

  it('parses recall request, result, and model snapshot contracts', () => {
    const request = MemoryRecallRequestSchema.parse({
      recallRequestId: 'recall-1',
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      queryText: 'How should tests be written?',
      requestedScopes: ['user', 'project'],
      requestedKinds: ['preference', 'decision'],
      maxResults: 8,
      createdAt: '2026-06-12T00:00:00.000Z',
      metadata: {},
    });

    const result = MemoryRecallResultSchema.parse({
      recallResultId: 'result-1',
      recallRequestId: request.recallRequestId,
      memoryId: 'memory-1',
      score: 0.82,
      rank: 1,
      selectedForContext: true,
      reason: 'Matches project testing preference.',
      createdAt: '2026-06-12T00:00:00.000Z',
      metadata: {},
    });

    const snapshot = MemoryRecallSnapshotSchema.parse({
      recallRequestId: request.recallRequestId,
      recalledAt: '2026-06-12T00:00:00.000Z',
      memories: [
        {
          memoryId: result.memoryId,
          scope: 'project',
          kind: 'decision',
          content: 'Use Vitest for unit tests.',
          reason: result.reason,
          score: result.score,
        },
      ],
    });

    expect(snapshot.memories).toHaveLength(1);
  });

  it('parses markdown mirror state without making markdown authoritative', () => {
    expect(MEMORY_MARKDOWN_MIRROR_STATUSES).toEqual(['synced', 'dirty', 'conflict', 'missing']);

    const mirror = MemoryMarkdownMirrorSchema.parse({
      mirrorId: 'mirror-1',
      scope: 'project',
      projectId: 'project-1',
      filePath: 'C:/repo/.megumi/memory/project.md',
      status: 'synced',
      lastImportedAt: '2026-06-12T00:00:00.000Z',
      lastExportedAt: '2026-06-12T00:00:00.000Z',
      contentHash: 'hash-1',
      metadata: {},
    });

    expect(mirror.status).toBe('synced');
  });

  it('exposes audit operations for capture, import, recall, and conflict diagnostics', () => {
    expect(MEMORY_RECORD_SOURCES).toEqual(['capture', 'markdown_import', 'manual_system']);
    expect(MEMORY_AUDIT_OPERATIONS).toEqual(
      expect.arrayContaining([
        'capture_evaluated',
        'extraction_skipped',
        'extraction_failed',
        'markdown_import_parsed',
        'markdown_import_failed',
        'memory_created',
        'memory_updated',
        'memory_superseded',
        'memory_deleted',
        'recall_requested',
        'recall_selected',
        'recall_failed',
        'conflict_detected',
      ]),
    );

    const audit = MemoryAuditLogSchema.parse({
      auditId: 'audit-1',
      operation: 'memory_created',
      targetKind: 'memory',
      targetId: 'memory-1',
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      actorKind: 'system',
      reason: 'Captured durable project testing decision.',
      beforeState: null,
      afterState: {
        scope: 'project',
        kind: 'decision',
        status: 'active',
      },
      createdAt: '2026-06-12T00:00:00.000Z',
      metadata: {},
    });

    expect(audit.afterState).not.toHaveProperty('content');
    expect(MemoryAuditLogSchema.safeParse({
      ...audit,
      auditId: 'audit-raw-content',
      afterState: {
        content: 'raw memory content must not be stored in audit state',
      },
    }).success).toBe(false);
  });
});

function validMemoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    memoryId: 'memory-1',
    scope: 'project',
    projectId: 'project-1',
    kind: 'decision',
    status: 'active',
    content: 'Use Vitest for unit tests.',
    summary: 'Testing framework decision',
    normalizedText: 'use vitest for unit tests',
    dedupeKey: 'project:project-1:decision:use-vitest',
    source: 'capture',
    sourceRunId: 'run-1',
    sourceSessionId: 'session-1',
    sourceMessageId: 'message-1',
    sourceToolCallId: null,
    evidence: [
      {
        kind: 'message',
        runId: 'run-1',
        sessionId: 'session-1',
        messageId: 'message-1',
      },
    ],
    supersededById: null,
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    lastUsedAt: '2026-06-12T00:00:00.000Z',
    useCount: 2,
    deletedAt: null,
    metadata: {},
    ...overrides,
  };
}
