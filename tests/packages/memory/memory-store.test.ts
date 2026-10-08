// @vitest-environment node
import { expect, it } from 'vitest';
import { createMemoryStore } from '@megumi/application/memory/memory-store';
import { createSourceFixture } from './source-fixture';

it('fences competing writers and rejects an expired owner after another writer takes over', () => {
  const f = createSourceFixture();
  let now = Date.parse('2026-10-08T00:00:00Z');

  try {
    const store = createMemoryStore(f.database, () => now);
    const first = store.acquire();

    expect(() => store.acquire()).toThrow('BUSY');

    now += 3600001;
    const second = store.acquire();

    expect(() => store.assertWriter(first)).toThrow('OWNER_LOST');

    store.release(first);
    store.assertWriter(second);
    f.database
      .prepare({
        sql: 'UPDATE memory_state SET control_revision = control_revision + 1, clear_pending = 1',
      })
      .run();

    expect(() => store.assertWriter(second)).toThrow('OWNER_LOST');
  } finally {
    f.database.close();
  }
});

it('recovers expired consolidation without resetting a live owner or certifying partial files', () => {
  const f = createSourceFixture();
  let now = Date.parse('2026-10-08T00:00:00Z');

  try {
    const store = createMemoryStore(f.database, () => now);
    store.beginRun('run', 'manual');
    const writer = store.acquire();
    store.claimJob(writer, 'run', {
      targetRevision: 0,
      selected: [],
      previous: [],
      added: [],
      removed: [],
      retained: [],
    });
    store.recover({ 'MEMORY.md': 'partial' });

    expect(store.state().artifact_state).toBe('updating');

    store.assertWriter(writer);
    now += 3600001;
    store.recover({ 'MEMORY.md': 'partial' });

    expect(store.state()).toMatchObject({
      artifact_state: 'needsRepair',
      writer_token: null,
      successful_snapshot_id: null,
    });
    expect(() => store.assertWriter(writer)).toThrow('OWNER_LOST');

    const run = f.database
      .prepare({ sql: "SELECT status FROM memory_runs WHERE run_id = 'run'" })
      .get();

    expect(run).toEqual({ status: 'failed' });
  } finally {
    f.database.close();
  }
});
