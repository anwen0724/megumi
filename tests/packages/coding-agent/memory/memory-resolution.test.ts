import { describe, expect, it } from 'vitest';
import { resolveMemoryCandidate } from '@megumi/coding-agent/memory';
import type { MemoryRecord } from '@megumi/coding-agent/memory/legacy-contracts/memory-contracts';

const now = '2026-06-12T00:00:00.000Z';

function record(input: Partial<MemoryRecord>): MemoryRecord {
  return {
    memoryId: input.memoryId ?? 'memory:1',
    scope: input.scope ?? 'project',
    projectId: input.projectId ?? 'project:1',
    kind: input.kind ?? 'decision',
    status: input.status ?? 'active',
    content: input.content ?? '项目文档使用中文。',
    summary: input.summary ?? input.content ?? '项目文档使用中文。',
    normalizedText: input.normalizedText ?? '项目文档使用中文',
    dedupeKey: input.dedupeKey ?? 'project:project:1:decision:项目文档使用中文',
    source: input.source ?? 'capture',
    sourceRunId: null,
    sourceSessionId: null,
    sourceMessageId: null,
    sourceToolCallId: null,
    evidence: [],
    supersededById: null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
    deletedAt: null,
    metadata: {},
    confidence: input.confidence ?? 0.8,
    ...input,
  };
}

describe('memory resolution', () => {
  it('dedupes exact normalized records into an update action', () => {
    const existing = record({ memoryId: 'memory:existing' });
    expect(resolveMemoryCandidate({
      candidate: {
        ...existing,
        memoryId: 'candidate:new',
        confidence: 0.95,
        updatedAt: now,
      },
      existingActiveRecords: [existing],
      now,
      createMemoryId: () => 'memory:new',
    })).toMatchObject({
      action: 'update_existing',
      targetMemoryId: 'memory:existing',
    });
  });

  it('detects conflict and does not create active memory', () => {
    const existing = record({ content: '用户希望回答简洁。', normalizedText: '用户希望回答简洁' });
    const candidate = record({ content: '用户希望回答尽量详细。', normalizedText: '用户希望回答尽量详细' });

    expect(resolveMemoryCandidate({
      candidate,
      existingActiveRecords: [existing],
      now,
      createMemoryId: () => 'memory:new',
    })).toMatchObject({
      action: 'conflict',
      conflictingMemoryId: existing.memoryId,
      reason: 'opposing_preference',
    });
  });

  it('supersedes a less specific old record with a more specific candidate', () => {
    const existing = record({ content: '项目文档使用中文。', normalizedText: '项目文档使用中文' });
    const candidate = record({
      content: '项目文档默认使用中文，文件名使用英文 kebab-case。',
      normalizedText: '项目文档默认使用中文 文件名使用英文 kebab-case',
    });

    expect(resolveMemoryCandidate({
      candidate,
      existingActiveRecords: [existing],
      now,
      createMemoryId: () => 'memory:new',
    })).toMatchObject({
      action: 'supersede',
      supersededMemoryId: existing.memoryId,
      newRecord: {
        memoryId: 'memory:new',
        status: 'active',
      },
      oldRecordPatch: {
        status: 'superseded',
        supersededById: 'memory:new',
      },
    });
  });
});
