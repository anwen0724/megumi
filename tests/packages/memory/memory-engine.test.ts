import { describe, expect, it } from 'vitest';
import {
  createDefaultMemoryPolicy,
  createMemoryCandidateDraft,
  evaluateMemoryCandidatePolicy,
  scoreMemoryRecordForRecall,
  selectMemoryRecallResults,
} from '@megumi/memory';
import type { MemoryRecord, MemorySourceRef } from '@megumi/shared/memory-contracts';

const now = '2026-05-16T00:00:00.000Z';

function sourceRef(ownerId: string): MemorySourceRef {
  return {
    sourceRefId: `memory-source:${ownerId}`,
    ownerId,
    ownerKind: ownerId.startsWith('memory-candidate') ? 'candidate' : 'memory',
    kind: 'message',
    refId: 'message:1',
    excerptPreview: '用户确认偏好。',
    createdAt: now,
  };
}

function memory(input: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    memoryId: input.memoryId ?? 'memory:1',
    workspaceId: 'workspace:1',
    scope: input.scope ?? 'workspace',
    kind: input.kind ?? 'workflow',
    content: input.content ?? '大功能先写 spec 再写 plan。',
    summary: input.summary ?? 'spec first workflow',
    sourceRefs: [sourceRef(input.memoryId ?? 'memory:1')],
    confidence: input.confidence ?? 0.9,
    status: input.status ?? 'active',
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    accessCount: input.accessCount ?? 0,
  };
}

describe('memory engine', () => {
  it('creates a conservative default policy and blocks high risk raw content', () => {
    const policy = createDefaultMemoryPolicy({ now });
    expect(policy.allowedScopes).toEqual(['user', 'workspace', 'project', 'session']);
    expect(policy.requiresReviewRiskLevels).toEqual(['medium', 'high']);

    expect(
      evaluateMemoryCandidatePolicy({
        policy,
        scope: 'workspace',
        kind: 'constraint',
        sourceKinds: ['message'],
        content: '-----BEGIN PRIVATE KEY-----',
      }),
    ).toMatchObject({
      allowed: false,
      riskLevel: 'blocked',
    });
  });

  it('creates safe candidate drafts without raw source content', () => {
    const candidate = createMemoryCandidateDraft({
      candidateId: 'memory-candidate:1',
      workspaceId: 'workspace:1',
      scope: 'workspace',
      kind: 'workflow',
      content: '  大功能先写 spec，再写 00 brief，再写 implementation plans。  ',
      sourceRefs: [sourceRef('memory-candidate:1')],
      proposedBy: 'agent',
      now,
    });

    expect(candidate.summary).toBe('大功能先写 spec，再写 00 brief，再写 implementation plans。');
    expect(candidate.status).toBe('proposed');
    expect(JSON.stringify(candidate)).not.toContain('raw full prompt');
  });

  it('scores and selects recall results with scope query status confidence and budget', () => {
    const first = memory({ memoryId: 'memory:workflow', content: 'spec brief plans workflow', confidence: 0.95 });
    const disabled = memory({ memoryId: 'memory:disabled', status: 'disabled', content: 'spec brief plans workflow' });
    const unrelated = memory({ memoryId: 'memory:other', content: 'provider adapter setting' });

    expect(scoreMemoryRecordForRecall(first, { scopes: ['workspace'], query: 'spec plans', kinds: ['workflow'] }).score)
      .toBeGreaterThan(scoreMemoryRecordForRecall(unrelated, { scopes: ['workspace'], query: 'spec plans' }).score);
    expect(scoreMemoryRecordForRecall(disabled, { scopes: ['workspace'], query: 'spec plans' }).eligible).toBe(false);

    const results = selectMemoryRecallResults({
      recallRequestId: 'memory-recall:1',
      records: [disabled, unrelated, first],
      scopes: ['workspace'],
      kinds: ['workflow'],
      query: 'spec plans',
      limit: 5,
      budget: 20,
      now,
    });

    expect(results.map((result) => result.memoryId)).toEqual(['memory:workflow']);
    expect(results[0].selectedForContext).toBe(true);
    expect(results[0].contentPreview).toBe('spec brief plans workflow');
  });
});
