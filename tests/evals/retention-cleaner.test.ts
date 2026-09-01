/* Protects age/size cleanup and pinned Baseline references. */
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanEvaluationRuns } from '../../evals/agent/reporting/retention-cleaner';

describe('Evaluation retention cleaner', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it('removes old complete Runs but preserves a pinned Run', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'megumi-eval-retention-'));
    await createRun(root, 'old', 1);
    await createRun(root, 'pinned', 1);
    await mkdir(path.join(root, 'baselines'), { recursive: true });
    await writeFile(path.join(root, 'baselines', 'base.json'), JSON.stringify({ pinnedRunId: 'run:pinned' }));
    const oldTime = new Date('2025-01-01T00:00:00.000Z');
    await utimes(path.join(root, 'runs', 'old'), oldTime, oldTime);
    await utimes(path.join(root, 'runs', 'pinned'), oldTime, oldTime);
    const result = await cleanEvaluationRuns({ evaluationRoot: root, nowMs: Date.parse('2026-01-01T00:00:00.000Z') });
    expect(result.removedRunIds).toEqual(['run:old']);
  });
});

async function createRun(root: string, directoryName: string, bytes: number): Promise<void> {
  const directory = path.join(root, 'runs', directoryName);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ runId: `run:${directoryName}` }));
  await writeFile(path.join(directory, 'result.json'), 'x'.repeat(bytes));
}

