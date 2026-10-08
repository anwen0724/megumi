// @vitest-environment node
import { expect, it } from 'vitest';
import { createMemorySources } from '@megumi/application/coding/sessions/memory-sources';
import { createExtractionStore } from '@megumi/application/memory/extraction-store';
import { createSourceFixture } from './source-fixture';

it('allows only one owner, persists empty success and does not extract the same version again', async () => {
  const f = createSourceFixture();
  try {
    await f.user('u1');
    const sources = createMemorySources({ store: f.store, isSessionRunning: () => false });
    const source = sources.readSnapshot('s1');
    if (source.status !== 'found') throw new Error('Source unavailable');
    const store = createExtractionStore(f.database);
    const now = '2026-10-08T12:00:00.000Z';
    store.beginRun('run1', now, false);
    const lease = store.claim({ runId: 'run1', jobId: 'job1', ownerToken: 'owner1', source: source.snapshot, now });
    expect(lease).toBeDefined();
    expect(store.claim({ runId: 'run1', jobId: 'job2', ownerToken: 'owner2', source: source.snapshot, now })).toBeUndefined();
    if (!lease) throw new Error('Source was not claimed');
    const coverage = { includedMessageIds: ['u1'], omittedMessageIds: [], truncated: false, estimatedInputTokens: 1, inputBudgetTokens: 10 };
    expect(store.complete({ lease, source: source.snapshot, output: { rawMemory: '', rolloutSummary: '', rolloutSlug: '' },
      coverage, now, result: { coverage, durationMs: 1, inputTokens: 10, outputTokens: 10 } })).toBe(true);
    expect(store.getExtraction('s1')).toMatchObject({ sourceVersion: source.snapshot.sourceVersion, rawMemory: '' });
    expect(store.claim({ runId: 'run1', jobId: 'job3', ownerToken: 'owner3', source: source.snapshot, now })).toBeUndefined();
    expect(f.database.prepare({ sql: 'SELECT dirty_revision FROM memory_state' }).get()).toEqual({ dirty_revision: 1 });
    expect(store.getJob('job1')).toMatchObject({ status: 'succeeded', attempt: 1 });
  } finally { f.database.close(); }
});

it('backs off failed versions, caps automatic attempts and gives an explicit retry a fresh budget', async () => {
  const f = createSourceFixture();
  try {
    await f.user('u1');
    const source = createMemorySources({ store: f.store, isSessionRunning: () => false }).readSnapshot('s1');
    if (source.status !== 'found') throw new Error('Source unavailable');
    const store = createExtractionStore(f.database);
    const start = Date.parse('2026-10-08T12:00:00Z');
    store.beginRun('run1', new Date(start).toISOString(), false);
    for (let index = 0; index < 3; index++) {
      const now = new Date(start + index * 3600000).toISOString();
      const lease = store.claim({ runId: 'run1', jobId: `job${index}`, ownerToken: `owner${index}`, source: source.snapshot, now });
      if (!lease) throw new Error('Retry was not admitted');
      store.settle(lease, 'failed', now, { code: 'INVALID_RESULT', message: 'Invalid JSON.' });
      expect(store.getJob(lease.jobId)).toMatchObject({ status: 'failed', attempt: index + 1 });
      expect(store.claim({ runId: 'run1', jobId: 'too-early', ownerToken: 'early', source: source.snapshot, now })).toBeUndefined();
    }
    const now = new Date(start + 4 * 3600000).toISOString();
    expect(store.claim({ runId: 'run1', jobId: 'exhausted', ownerToken: 'late', source: source.snapshot, now })).toBeUndefined();
    const retried = store.claim({ runId: 'run1', jobId: 'manual', ownerToken: 'manual-owner', source: source.snapshot, now, failedJobId: 'job2' });
    expect(retried).toBeDefined();
    expect(store.getJob('manual')).toMatchObject({ attempt: 1, retryOfJobId: 'job2' });
    if (!retried) throw new Error('Retry was not created');
    store.settle(retried, 'failed', now, { code: 'INVALID_RESULT', message: 'Invalid JSON.' });
    expect(store.claim({ runId: 'run1', jobId: 'repeat-request', ownerToken: 'repeat-owner', source: source.snapshot, now, failedJobId: 'job2' })).toBeUndefined();
    expect(store.getExtraction('s1')).toBeUndefined();
    expect(f.database.prepare({ sql: 'SELECT dirty_revision FROM memory_state' }).get()).toEqual({ dirty_revision: 0 });
  } finally { f.database.close(); }
});

it('takes over an expired lease and rejects the former owner without overwriting the new attempt', async () => {
  const f = createSourceFixture();
  try {
    await f.user('u1');
    const source = createMemorySources({ store: f.store, isSessionRunning: () => false }).readSnapshot('s1');
    if (source.status !== 'found') throw new Error('Source unavailable');
    const store = createExtractionStore(f.database);
    store.beginRun('run1', '2026-10-08T12:00:00.000Z', false);
    const first = store.claim({ runId: 'run1', jobId: 'first', ownerToken: 'old', source: source.snapshot, now: '2026-10-08T12:00:00.000Z' });
    store.beginRun('run2', '2026-10-08T13:00:00.000Z', false);
    const second = store.claim({ runId: 'run2', jobId: 'second', ownerToken: 'new', source: source.snapshot, now: '2026-10-08T13:00:00.000Z' });
    expect(second).toBeDefined();
    if (!first || !second) throw new Error('Lease not created');
    expect(store.isCurrent(first, '2026-10-08T13:00:00.000Z')).toBe(false);
    const coverage = { includedMessageIds: ['u1'], omittedMessageIds: [], truncated: false, estimatedInputTokens: 1, inputBudgetTokens: 10 };
    expect(store.complete({ lease: first, source: source.snapshot, now: '2026-10-08T13:00:00.000Z', coverage,
      output: { rawMemory: 'stale', rolloutSummary: 'stale', rolloutSlug: '' },
      result: { coverage, durationMs: 0, inputTokens: 1, outputTokens: 1 } })).toBe(false);
    store.settle(first, 'cancelled', '2026-10-08T13:00:00.000Z', { code: 'CANCELLED', message: 'Late cancellation.' });
    expect(store.getJob('second')).toMatchObject({ status: 'running' });
    expect(store.getJob('first')).toMatchObject({ status: 'failed', error: { code: 'LEASE_EXPIRED' } });
    expect(f.database.prepare({ sql: "SELECT status FROM memory_runs WHERE run_id = 'run1'" }).get()).toEqual({ status: 'failed' });
  } finally { f.database.close(); }
});
