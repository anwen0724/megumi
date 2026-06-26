import { describe, expect, it } from 'vitest';
import {
  createMemoryUpdateActionInputPreview,
  createMemoryUpdateIntent,
  createMemoryRecallContextSource,
  selectMemoryRecallIdsForContext,
} from '@megumi/coding-agent/memory/memory-action-mapper';
import type { MemoryRecallResult } from '@megumi/shared/memory';

const now = '2026-05-16T00:00:00.000Z';

function result(id: string, selectedForContext: boolean): MemoryRecallResult {
  return {
    recallResultId: id,
    recallRequestId: 'memory-recall:1',
    memoryId: `memory:${id}`,
    score: 0.9,
    rank: 1,
    selectedForContext,
    reason: 'scope_match query_match',
    createdAt: now,
    metadata: {
      scope: 'project',
      kind: 'decision',
      contentPreview: '大功能先写 spec 再写 plan。',
      tokenEstimate: 8,
    },
  };
}

describe('core memory runtime helpers', () => {
  it('creates update_memory action input previews without raw content', () => {
    expect(
      createMemoryUpdateActionInputPreview({
        operation: 'candidate_proposed',
        candidateId: 'memory-candidate:1',
        memoryId: 'memory:1',
        summary: 'safe summary',
        sourceRefCount: 2,
      }),
    ).toEqual({
      operation: 'candidate_proposed',
      candidateId: 'memory-candidate:1',
      memoryId: 'memory:1',
      summary: 'safe summary',
      sourceRefCount: 2,
    });
  });

  it('creates memory update intent for lifecycle action consumers', () => {
    const intent = createMemoryUpdateIntent({
      actionId: 'action:memory:1',
      runId: 'run:1',
      stepId: 'step:memory:1',
      operation: 'candidate_proposed',
      summary: 'safe memory candidate',
      requestedAt: now,
    });

    expect(intent.kind).toBe('update_memory');
    expect(intent.status).toBe('requested');
    expect(intent.inputPreview?.operation).toBe('candidate_proposed');
  });

  it('bridges selected recall results into RunContext memory refs', () => {
    const selected = result('selected', true);
    const skipped = result('skipped', false);

    expect(selectMemoryRecallIdsForContext([selected, skipped])).toEqual(['selected']);
    expect(createMemoryRecallContextSource(selected, now)).toMatchObject({
      sourceKind: 'memory_recall',
      sourceUri: 'memory://memory:selected',
      freshness: 'fresh',
      redactionState: 'redacted',
      selectionReason: 'memory_recall',
    });
  });
});


