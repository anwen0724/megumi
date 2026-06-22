import { describe, expect, it } from 'vitest';
import {
  createDefaultMemoryPolicy,
  createMemoryCandidateDraft,
  evaluateMemoryCandidatePolicy,
  scoreMemoryRecordForRecall,
  selectMemoryRecallResults,
} from '@megumi/coding-agent/memory';
import type { MemoryRecord, MemorySourceRef } from '@megumi/shared/memory';

const now = '2026-06-12T00:00:00.000Z';

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
    scope: input.scope ?? 'project',
    projectId: input.scope === 'user' ? null : 'project:1',
    kind: input.kind ?? 'decision',
    status: input.status ?? 'active',
    content: input.content ?? 'Use Vitest for unit tests.',
    summary: input.summary ?? 'Testing framework decision',
    normalizedText: input.normalizedText ?? 'use vitest for unit tests',
    dedupeKey: input.dedupeKey ?? 'project:project:1:decision:use-vitest',
    source: input.source ?? 'capture',
    sourceRunId: 'run:1',
    sourceSessionId: 'session:1',
    sourceMessageId: 'message:1',
    sourceToolCallId: null,
    evidence: [],
    supersededById: null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    lastUsedAt: input.lastUsedAt ?? now,
    useCount: input.useCount ?? 0,
    deletedAt: null,
    metadata: {},
    ...input,
  };
}

describe('memory engine', () => {
  it('creates a conservative default policy and blocks high risk raw content', () => {
    const policy = createDefaultMemoryPolicy({ now });
    expect(policy.allowedScopes).toEqual(['user', 'project']);
    expect(policy.allowedKinds).toEqual(['preference', 'constraint', 'fact', 'decision']);
    expect(policy.requiresReviewRiskLevels).toEqual(['medium', 'high']);
    expect(policy.autoCaptureEnabled).toBe(false);

    expect(
      evaluateMemoryCandidatePolicy({
        policy,
        scope: 'project',
        kind: 'constraint',
        sourceKinds: ['message'],
        content: '-----BEGIN PRIVATE KEY-----',
      }),
    ).toMatchObject({
      allowed: false,
      riskLevel: 'blocked',
    });
  });

  it('requires explicit opt-in before automatic memory capture policy allows candidates', () => {
    const disabledPolicy = createDefaultMemoryPolicy({ now });
    expect(evaluateMemoryCandidatePolicy({
      policy: disabledPolicy,
      scope: 'project',
      kind: 'constraint',
      sourceKinds: ['message'],
      content: 'Use Vitest for unit tests.',
    })).toMatchObject({
      allowed: false,
      reason: 'auto_capture_disabled',
    });

    const enabledPolicy = createDefaultMemoryPolicy({ now, autoCaptureEnabled: true });
    expect(evaluateMemoryCandidatePolicy({
      policy: enabledPolicy,
      scope: 'project',
      kind: 'constraint',
      sourceKinds: ['message'],
      content: 'Use Vitest for unit tests.',
    })).toMatchObject({
      allowed: true,
    });
  });

  it('creates compatible candidate drafts with 18.02 scope and kind vocabulary', () => {
    const candidate = createMemoryCandidateDraft({
      candidateId: 'memory-candidate:1',
      projectId: 'project:1',
      sessionId: 'session:1',
      scope: 'project',
      kind: 'decision',
      content: '  大功能先写 spec，再写 00 brief，再写 implementation plans。  ',
      sourceRefs: [sourceRef('memory-candidate:1')],
      proposedBy: 'agent',
      now,
    });

    expect(candidate.scope).toBe('project');
    expect(candidate.kind).toBe('decision');
    expect(candidate.summary).toBe('大功能先写 spec，再写 00 brief，再写 implementation plans。');
    expect(candidate.status).toBe('proposed');
    expect(JSON.stringify(candidate)).not.toContain('raw full prompt');
  });

  it('scores and selects recall results with 18.02 lifecycle and usage metadata', () => {
    const first = memory({
      memoryId: 'memory:decision',
      content: 'spec brief plans vitest',
      normalizedText: 'spec brief plans vitest',
      useCount: 3,
    });
    const superseded = memory({
      memoryId: 'memory:superseded',
      status: 'superseded',
      content: 'spec brief plans vitest',
    });
    const deleted = memory({
      memoryId: 'memory:deleted',
      status: 'deleted',
      content: 'spec brief plans vitest',
    });
    const unrelated = memory({
      memoryId: 'memory:other',
      kind: 'fact',
      content: 'provider adapter setting',
      normalizedText: 'provider adapter setting',
    });

    expect(scoreMemoryRecordForRecall(first, { projectId: 'project:1', query: 'spec plans', kinds: ['decision'] }).score)
      .toBeGreaterThan(scoreMemoryRecordForRecall(unrelated, { projectId: 'project:1', query: 'spec plans' }).score);
    expect(scoreMemoryRecordForRecall(superseded, { projectId: 'project:1', query: 'spec plans' }).eligible).toBe(false);
    expect(scoreMemoryRecordForRecall(deleted, { projectId: 'project:1', query: 'spec plans' }).eligible).toBe(false);

    const results = selectMemoryRecallResults({
      recallRequestId: 'memory-recall:1',
      records: [deleted, unrelated, superseded, first],
      projectId: 'project:1',
      query: 'spec plans',
      limit: 5,
      budget: 20,
      now,
    });

    expect(results).toEqual([
      {
        recallResultId: 'memory-recall:1:result:1',
        recallRequestId: 'memory-recall:1',
        memoryId: 'memory:decision',
        score: expect.any(Number),
        rank: 1,
        selectedForContext: true,
        reason: 'project_scope kind_priority lexical_match',
        createdAt: now,
        metadata: {
          tokenEstimate: 6,
          scope: 'project',
          kind: 'decision',
          contentPreview: 'spec brief plans vitest',
        },
      },
    ]);
  });
});
