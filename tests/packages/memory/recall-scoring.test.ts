import { describe, expect, it } from 'vitest';
import {
  buildMemoryRecallSnapshot,
  selectMemoryRecallResults,
} from '@megumi/memory';
import type { MemoryRecord } from '@megumi/shared/memory';

const now = '2026-06-12T00:00:00.000Z';

function memory(input: Partial<MemoryRecord>): MemoryRecord {
  return {
    memoryId: input.memoryId ?? 'memory:1',
    scope: input.scope ?? 'project',
    projectId: input.scope === 'user' ? null : input.projectId ?? 'project:1',
    kind: input.kind ?? 'decision',
    status: input.status ?? 'active',
    content: input.content ?? 'Use Vitest for unit tests.',
    summary: input.summary ?? input.content ?? 'Use Vitest for unit tests.',
    normalizedText: input.normalizedText ?? 'use vitest for unit tests',
    dedupeKey: input.dedupeKey ?? 'project:project:1:decision:use vitest for unit tests',
    source: input.source ?? 'capture',
    sourceRunId: null,
    sourceSessionId: null,
    sourceMessageId: null,
    sourceToolCallId: null,
    evidence: [],
    supersededById: null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    lastUsedAt: input.lastUsedAt ?? null,
    useCount: input.useCount ?? 0,
    deletedAt: null,
    metadata: {},
    confidence: input.confidence ?? 0.8,
    ...input,
  };
}

describe('memory recall scoring', () => {
  it('selects active user and current-project records only', () => {
    const results = selectMemoryRecallResults({
      recallRequestId: 'memory-recall:1',
      records: [
        memory({ memoryId: 'current', projectId: 'project:1', content: 'Use Vitest for unit tests.' }),
        memory({ memoryId: 'other-project', projectId: 'project:2', content: 'Use Jest.' }),
        memory({ memoryId: 'user-pref', scope: 'user', projectId: null, kind: 'preference', content: 'Prefer concise answers.' }),
        memory({ memoryId: 'deleted', status: 'deleted', content: 'Use Vitest.' }),
        memory({ memoryId: 'superseded', status: 'superseded', content: 'Use Vitest.' }),
      ],
      projectId: 'project:1',
      query: 'vitest concise',
      limit: 8,
      budget: 100,
      now,
    });

    expect(results.map((result) => result.memoryId)).toEqual(['current', 'user-pref']);
  });

  it('excludes project memories when there is no current project id', () => {
    const results = selectMemoryRecallResults({
      recallRequestId: 'memory-recall:1',
      records: [
        memory({ memoryId: 'project-memory', projectId: 'project:1', content: 'Use Vitest for unit tests.' }),
        memory({ memoryId: 'user-memory', scope: 'user', projectId: null, kind: 'preference', content: 'Prefer concise answers.' }),
      ],
      projectId: undefined,
      query: 'vitest concise',
      limit: 8,
      budget: 100,
      now,
    });

    expect(results.map((result) => result.memoryId)).toEqual(['user-memory']);
  });

  it('excludes other-project records when current project id does not match', () => {
    const results = selectMemoryRecallResults({
      recallRequestId: 'memory-recall:1',
      records: [
        memory({ memoryId: 'current-project', projectId: 'project:1', content: 'Use Vitest for unit tests.' }),
        memory({ memoryId: 'other-project', projectId: 'project:2', content: 'Use Vitest for unit tests.' }),
      ],
      projectId: 'project:1',
      query: 'vitest',
      limit: 8,
      budget: 100,
      now,
    });

    expect(results.map((result) => result.memoryId)).toEqual(['current-project']);
  });

  it('weights kind priority, lexical match, recency, confidence, and usage deterministically', () => {
    const results = selectMemoryRecallResults({
      recallRequestId: 'memory-recall:1',
      records: [
        memory({ memoryId: 'fact', kind: 'fact', content: 'Vitest is installed.', confidence: 0.95 }),
        memory({ memoryId: 'constraint', kind: 'constraint', content: 'Tests must use Vitest.', confidence: 0.8, useCount: 2, lastUsedAt: now }),
      ],
      projectId: 'project:1',
      query: 'vitest tests',
      limit: 8,
      budget: 100,
      now,
    });

    expect(results[0]?.memoryId).toBe('constraint');
    expect(results[0]?.rank).toBe(1);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('builds a run-scoped snapshot with budget diagnostics', () => {
    const snapshot = buildMemoryRecallSnapshot({
      snapshotId: 'memory-recall-snapshot:1',
      recallRequestId: 'memory-recall:1',
      sessionId: 'session:1',
      runId: 'run:1',
      projectId: 'project:1',
      query: 'vitest',
      records: [
        memory({ memoryId: 'selected', content: 'Use Vitest for unit tests.' }),
        memory({ memoryId: 'inactive', status: 'deleted', content: 'Use Jest.' }),
      ],
      maxResults: 8,
      maxTokens: 4,
      now,
    });

    expect(snapshot.selected).toHaveLength(0);
    expect(snapshot.budget.truncated).toBe(true);
    expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ memoryId: 'inactive', reason: 'inactive_status' }),
      expect.objectContaining({ reason: 'budget_exceeded' }),
    ]));
  });

  it('records diagnostics for project memories excluded without current project id', () => {
    const snapshot = buildMemoryRecallSnapshot({
      snapshotId: 'memory-recall-snapshot:1',
      recallRequestId: 'memory-recall:1',
      sessionId: 'session:1',
      runId: 'run:1',
      projectId: null,
      query: 'vitest',
      records: [
        memory({ memoryId: 'project-memory', projectId: 'project:1', content: 'Use Vitest for unit tests.' }),
        memory({ memoryId: 'user-memory', scope: 'user', projectId: null, kind: 'preference', content: 'Prefer concise answers.' }),
      ],
      maxResults: 8,
      maxTokens: 100,
      now,
    });

    expect(snapshot.selected.map((item) => item.memoryId)).toEqual(['user-memory']);
    expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ memoryId: 'project-memory', reason: 'scope_mismatch' }),
    ]));
  });
});
