// @vitest-environment node
import { expect, it } from 'vitest';
import { selectExtractionSources } from '@megumi/application/memory/extraction-selection';
import { MemoryConfigurationSchema } from '@megumi/application/settings/definitions/memory';
import type { MemorySourceInfo } from '@megumi/application/memory/source-contracts';

it('includes idle and age boundaries and archived sources, while excluding active, current and non-conversation sources', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const source = (
    sessionId: string,
    hours: number,
    extra: Partial<MemorySourceInfo> = {},
  ): MemorySourceInfo => ({
    sessionId,
    workspaceId: 'w',
    title: sessionId,
    archived: false,
    running: false,
    contentUpdatedAt: new Date(now - hours * 3600000).toISOString(),
    ...extra,
  });
  const chosen = selectExtractionSources({
    now,
    configuration: MemoryConfigurationSchema.parse({}),
    triggerSessionId: 'current',
    sources: [
      source('current', 7),
      source('running', 7, { running: true }),
      source('new', 5.99),
      source('expired', 720.01),
      source('old-boundary', 720, { archived: true }),
      source('idle-boundary', 6),
      source('internal', 7, { kind: 'internal' }),
      source('temporary', 7, { kind: 'temporary' }),
    ],
  });
  expect(chosen.map(item => item.sessionId)).toEqual(['idle-boundary', 'old-boundary']);
});

it('scans only the newest 5000 identities, breaking equal timestamps by descending session ID', () => {
  const sources: MemorySourceInfo[] = Array.from({ length: 5001 }, (_, index) => ({
    sessionId: `s${index.toString().padStart(4, '0')}`,
    workspaceId: 'w',
    title: '',
    archived: false,
    running: false,
    contentUpdatedAt: '2026-10-07T00:00:00Z',
  }));
  const chosen = selectExtractionSources({
    sources,
    now: Date.parse('2026-10-08T12:00:00Z'),
    configuration: MemoryConfigurationSchema.parse({}),
  });
  expect(chosen).toHaveLength(5000);
  expect(chosen[0].sessionId).toBe('s5000');
  expect(chosen.at(-1)?.sessionId).toBe('s0001');
});
