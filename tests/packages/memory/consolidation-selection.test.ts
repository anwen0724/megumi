// @vitest-environment node
import { expect, it } from 'vitest';
import { createMemorySources } from '@megumi/application/coding/sessions/memory-sources';
import { selectConsolidationSources } from '@megumi/application/memory/consolidation-selection';
import { createExtractionStore } from '@megumi/application/memory/extraction-store';
import { MemoryConfigurationSchema } from '@megumi/application/settings/definitions/memory';
import { createSourceFixture } from './source-fixture';

it('keeps the prior version as removed when its current extraction becomes empty', async () => {
  const f = createSourceFixture();
  try {
    await f.user('u1');
    const sources = createMemorySources({ store: f.store, isSessionRunning: () => false });
    const store = createExtractionStore(f.database);
    const now = '2026-10-08T12:00:00.000Z';
    function save(id: string, rawMemory: string) {
      const read = sources.readSnapshot('s1');
      if (read.status !== 'found') throw new Error('Source missing');
      store.beginRun(id, now, false);
      const lease = store.claim({ runId: id, jobId: id, ownerToken: id, source: read.snapshot, now })!;
      const coverage = { includedMessageIds: ['u1'], omittedMessageIds: [], truncated: false, estimatedInputTokens: 1, inputBudgetTokens: 100 };
      store.complete({ lease, source: read.snapshot, now, coverage, output: { rawMemory, rolloutSummary: rawMemory, rolloutSlug: '' }, result: { coverage, durationMs: 1, inputTokens: 1, outputTokens: 1 } });
    }
    save('first', 'Use TypeScript');
    const input = { database: f.database, sources, configuration: MemoryConfigurationSchema.parse({}), now: Date.parse(now) };
    const first = selectConsolidationSources(input);
    expect(first.added.map(source => source.sessionId)).toEqual(['s1']);
    expect(selectConsolidationSources({ ...input, now: Date.parse(now) + 366 * 86400000 }).selected).toEqual([]);
    const old = first.selected[0];
    // Seed the prior successful snapshot through the persistence contract.
    f.database.prepare({ sql: "INSERT INTO memory_snapshots VALUES ('snap',1,'{}',?)" }).run([now]);
    f.database.prepare({ sql: "INSERT INTO memory_snapshot_sources VALUES ('snap',?,?,0,?)" }).run([old.sessionId, old.sourceVersion, old.artifactPath]);
    f.database.prepare({ sql: "UPDATE memory_state SET successful_snapshot_id = 'snap', processed_revision = 1" }).run();
    await f.user('u2', 'No reusable knowledge remains.');
    save('second', '');
    const second = selectConsolidationSources(input);
    expect(second.selected).toEqual([]);
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([old]);
    expect(second.removed[0].rawMemory).toBe('Use TypeScript');
    expect(second.targetRevision).toBe(2);
  } finally { f.database.close(); }
});

it('ranks by usage, then recent use and source identity before applying capacity', async () => {
  const f = createSourceFixture();
  try {
    const now = '2026-10-08T12:00:00.000Z';
    const sources = createMemorySources({ store: f.store, isSessionRunning: () => false });
    const store = createExtractionStore(f.database);
    for (const id of ['s1', 's2', 's3']) {
      if (id !== 's1') f.store.insertSession({ session_id: id, workspace_id: 'w1', title: id, status: 'active', created_at: now, updated_at: now });
      await f.history.saveUserMessage({ session_id: id, message_id: id, display_content: [{ type: 'text', text: 'Use TypeScript.' }], model_content: [{ type: 'text', text: 'Use TypeScript.' }], created_at: '2026-10-02T00:00:00.000Z' });
      const read = sources.readSnapshot(id); if (read.status !== 'found') throw new Error();
      store.beginRun(id, now, false);
      const lease = store.claim({ runId: id, jobId: id, ownerToken: id, source: read.snapshot, now })!;
      const coverage = { includedMessageIds: [id], omittedMessageIds: [], truncated: false, estimatedInputTokens: 1, inputBudgetTokens: 100 };
      store.complete({ lease, source: read.snapshot, now, coverage, output: { rawMemory: 'Use TS', rolloutSummary: 'TS', rolloutSlug: '' }, result: { coverage, durationMs: 1, inputTokens: 1, outputTokens: 1 } });
    }
    // Usage is a persisted input contract; P4 owns recording it from verified replies.
    f.database.prepare({ sql: "UPDATE memory_sources SET usage_count = 1 WHERE session_id IN ('s1','s2')" }).run();
    f.database.prepare({ sql: "UPDATE memory_sources SET last_used_at = '2026-10-07T00:00:00.000Z' WHERE session_id = 's1'" }).run();
    const configuration = MemoryConfigurationSchema.parse({ maxConsolidationSources: 2 });
    expect(selectConsolidationSources({ database: f.database, sources, configuration, now: Date.parse(now) }).selected.map(source => source.sessionId)).toEqual(['s1', 's2']);
    f.database.prepare({ sql: "UPDATE memory_sources SET last_used_at = NULL" }).run();
    expect(selectConsolidationSources({ database: f.database, sources, configuration, now: Date.parse(now) }).selected.map(source => source.sessionId)).toEqual(['s2', 's1']);
  } finally { f.database.close(); }
});
