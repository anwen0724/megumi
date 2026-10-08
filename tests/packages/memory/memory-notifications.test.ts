// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { productionFixture } from './production-fixture';

it('publishes queryable extraction progress and completion without starting work on reads', async () => {
  const f = productionFixture();
  try {
    await f.user('u1', 'Use TypeScript for React examples.');
    const events: { processInstanceId: string; sequence: number; revision: number; runId?: string }[] = [];
    const stages: string[] = [];
    const unsubscribe = f.memory.subscribeChanges(event => {
      events.push(event);
      if (event.runId) {
        const run = f.memory.getRun(event.runId);
        stages.push(...(run?.jobs.map(job => `${job.stage}:${job.status}`) ?? []));
      }
    });
    f.memory.getStatus(); f.memory.listDocuments(); f.memory.listSources();
    expect(events).toHaveLength(0);
    f.responses();
    const run = await f.generate();
    expect(stages).toContain('extract:running');
    expect(stages).toContain('extract:succeeded');
    expect(events.at(-1)?.runId).toBe(run.runId);
    expect(new Set(events.map(event => event.processInstanceId)).size).toBe(1);
    expect(events.map(event => event.sequence)).toEqual(events.map((_, index) => index + 1));
    unsubscribe();
    const count = events.length;
    await f.generate('next');
    expect(events).toHaveLength(count);
  } finally { await f.dispose(); }
});


it('keeps the triggering session excluded when concurrent entries merge into a follow-up', async () => {
  const f = productionFixture();
  try {
    await f.user('u1', 'Current open history must not be learned.');
    const first = f.memory.startGeneration({ requestId: 'entry-1', reason: 'startup', triggerSessionId: 's1' });
    const second = f.memory.startGeneration({ requestId: 'entry-2', reason: 'startup', triggerSessionId: 's1' });
    expect(first).toMatchObject({ status: 'started' });
    expect(second).toMatchObject({ status: 'reused' });
    await vi.waitFor(() => {
      const status = f.memory.getStatus();
      if (status.status !== 'ok') throw new Error('State unavailable');
      expect(status.memory.recentRuns).toHaveLength(2);
      expect(status.memory.recentRuns.every(run => run.status === 'completed')).toBe(true);
      expect(status.memory.recentRuns.flatMap(run => run.jobs)).toHaveLength(0);
    });
  } finally { await f.dispose(); }
});


it.each([('short line content '.repeat(8) + '\n').repeat(300), 'long '.repeat(6000) + '\nend'])('reads every character across bounded document pages', async content => {
  const f = productionFixture();
  try {
    mkdirSync(path.join(f.root, 'memories'), { recursive: true });
    writeFileSync(path.join(f.root, 'memories', 'MEMORY.md'), content);
    let startLine = 1; let startCharacter = 0; let version: string | undefined; let joined = '';
    for (let page = 0; page < 20; page++) {
      const result = f.memory.readDocument({ path: 'MEMORY.md', startLine, startCharacter, expectedVersion: version });
      if (result.status !== 'found') throw new Error(JSON.stringify(result));
      const slice = result.document;
      expect(slice.content.length).toBeLessThanOrEqual(16000);
      joined += slice.content; version = slice.version;
      if (!slice.truncated) break;
      startLine = slice.nextLine; startCharacter = slice.nextCharacter ?? 0;
    }
    expect(joined.length).toBe(content.length);
    expect(joined).toBe(content);
  } finally { await f.dispose(); }
});
