import { describe, expect, it } from 'vitest';

import {
  SessionCompactionEntrySchema,
  type SessionCompactionEntry,
} from '@megumi/shared/session';

const validEntry: SessionCompactionEntry = {
  compactionId: 'compaction-1',
  sessionId: 'session-1',
  summary: '用户讨论了 context compaction 的持久化边界。',
  summaryKind: 'compaction',
  firstKeptSourceRef: {
    sourceId: 'message-3',
    sourceKind: 'session_message',
    loadedAt: '2026-05-31T10:00:00.000Z',
  },
  tokensBefore: 180000,
  triggerReason: 'context_budget_pressure',
  status: 'completed',
  createdAt: '2026-05-31T10:05:00.000Z',
  metadata: { previousCompactionId: 'compaction-0', summarizedSourceCount: 2 },
};

describe('SessionCompactionEntrySchema', () => {
  it('parses a completed context compaction entry', () => {
    expect(SessionCompactionEntrySchema.parse(validEntry)).toEqual(validEntry);
  });

  it('requires a non-empty summary', () => {
    expect(() =>
      SessionCompactionEntrySchema.parse({
        ...validEntry,
        summary: '',
      }),
    ).toThrow();
  });

  it('requires a valid source-ref boundary for the first kept context source', () => {
    expect(() =>
      SessionCompactionEntrySchema.parse({
        ...validEntry,
        firstKeptSourceRef: {
          sourceId: 'message-3',
          sourceKind: 'unknown',
        },
      }),
    ).toThrow();
  });

  it('accepts optional summarized file metadata', () => {
    expect(
      SessionCompactionEntrySchema.parse({
        ...validEntry,
        metadata: {
          ...validEntry.metadata,
          readFiles: ['packages/shared/session-context-contracts.ts'],
          modifiedFiles: ['packages/shared/session-compaction-contracts.ts'],
        },
      }).metadata,
    ).toEqual({
      previousCompactionId: 'compaction-0',
      summarizedSourceCount: 2,
      readFiles: ['packages/shared/session-context-contracts.ts'],
      modifiedFiles: ['packages/shared/session-compaction-contracts.ts'],
    });
  });

  it('rejects invalid summarized file metadata entries', () => {
    expect(() =>
      SessionCompactionEntrySchema.parse({
        ...validEntry,
        metadata: {
          readFiles: ['packages/shared/session-context-contracts.ts', 1],
        },
      }),
    ).toThrow();
  });

  it('rejects negative token counts', () => {
    expect(() =>
      SessionCompactionEntrySchema.parse({
        ...validEntry,
        tokensBefore: -1,
      }),
    ).toThrow();
  });
});

