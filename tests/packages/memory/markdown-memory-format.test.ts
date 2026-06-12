import { describe, expect, it } from 'vitest';
import {
  parseMemoryMarkdown,
  renderMemoryMarkdown,
} from '@megumi/memory';
import type { MemoryRecord } from '@megumi/shared/memory';

const now = '2026-06-12T00:00:00.000Z';

function memory(input: Partial<MemoryRecord>): MemoryRecord {
  return {
    memoryId: input.memoryId ?? 'memory:1',
    scope: input.scope ?? 'user',
    projectId: input.projectId ?? null,
    kind: input.kind ?? 'preference',
    status: input.status ?? 'active',
    content: input.content ?? '用户希望先讨论 spec。',
    summary: input.summary ?? input.content ?? '用户希望先讨论 spec。',
    normalizedText: input.normalizedText ?? '用户希望先讨论 spec',
    dedupeKey: input.dedupeKey ?? 'user::preference:用户希望先讨论 spec',
    source: input.source ?? 'capture',
    sourceRunId: null,
    sourceSessionId: null,
    sourceMessageId: null,
    sourceToolCallId: null,
    evidence: [],
    supersededById: null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    lastUsedAt: null,
    useCount: 0,
    deletedAt: null,
    metadata: {},
    confidence: 0.9,
    ...input,
  };
}

describe('memory markdown format', () => {
  it('parses grouped markdown entries, metadata anchors, no-id entries, and unknown heading diagnostics', () => {
    const parsed = parseMemoryMarkdown({
      scope: 'user',
      markdown: [
        '# User Memory',
        '## Preference',
        '<!-- memory:id=memory:1 kind=preference updated=2026-06-12T00:00:00.000Z -->',
        '- 用户希望先讨论 spec。',
        '- 用户希望回答简洁。',
        '## Unknown',
        '- should be ignored',
      ].join('\n'),
    });

    expect(parsed.entries).toEqual([
      expect.objectContaining({ memoryId: 'memory:1', kind: 'preference', text: '用户希望先讨论 spec。' }),
      expect.objectContaining({ memoryId: null, kind: 'preference', text: '用户希望回答简洁。' }),
    ]);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ reason: 'unknown_heading', heading: 'Unknown' }),
    ]);
  });

  it('infers import kind from heading and reports metadata kind mismatches', () => {
    const parsed = parseMemoryMarkdown({
      scope: 'user',
      markdown: [
        '# User Memory',
        '## Preference',
        '<!-- memory:id=memory:1 kind=decision updated=2026-06-12T00:00:00.000Z -->',
        '- 用户希望回答简洁。',
      ].join('\n'),
    });

    expect(parsed.entries).toEqual([
      expect.objectContaining({ memoryId: 'memory:1', kind: 'preference', text: '用户希望回答简洁。' }),
    ]);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ reason: 'metadata_kind_mismatch', heading: 'Preference' }),
    ]);
  });

  it('renders active records only with fixed kind order and updatedAt desc', () => {
    const rendered = renderMemoryMarkdown({
      title: 'User Memory',
      records: [
        memory({ memoryId: 'deleted', status: 'deleted', content: 'deleted' }),
        memory({ memoryId: 'decision-old', kind: 'decision', content: 'old', updatedAt: '2026-06-11T00:00:00.000Z' }),
        memory({ memoryId: 'decision-new', kind: 'decision', content: 'new', updatedAt: '2026-06-12T00:00:00.000Z' }),
        memory({ memoryId: 'constraint', kind: 'constraint', content: 'constraint' }),
      ],
    });

    expect(rendered).toContain('# User Memory');
    expect(rendered).toMatch(/## Preference[\s\S]*## Constraint[\s\S]*## Fact[\s\S]*## Decision/);
    expect(rendered).not.toContain('deleted');
    expect(rendered.indexOf('new')).toBeLessThan(rendered.indexOf('old'));
    expect(rendered).toContain('<!-- memory:id=decision-new kind=decision updated=2026-06-12T00:00:00.000Z -->');
  });
});
