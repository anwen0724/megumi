/*
 * Protects atomic evaluation sealing against transient locks and permanent storage failures.
 */
// @vitest-environment node
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunStorage } from '../../evals/agent/run/run-storage';
import { EvaluationRunRecordSchema } from '../../evals/agent/contracts/evaluation-run';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('evaluation archive sealing', () => {
  it.each(['EPERM', 'EBUSY'])('recovers from a transient %s without rewriting the sealed record', async (code) => {
    const storage = await fixture();
    const record = runRecord();
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('Temporary lock'), { code }));
    await storage.writeRunRecord(record);
    expect(JSON.parse(await readFile(path.join(storage.runDirectory, 'run.json'), 'utf8'))).toEqual(record);
    await expect(storage.writeRunRecord(record)).rejects.toThrow(/already exists/);
  });
  it.each(['EIO', 'EPERM'])('preserves the draft when %s does not recover', async (code) => {
    const storage = await fixture();
    vi.mocked(rename).mockRejectedValue(Object.assign(new Error('Persistent failure'), { code }));
    await expect(storage.writeRunRecord(runRecord())).rejects.toThrow('Persistent failure');
    expect(JSON.parse(await readFile(path.join(storage.runDirectory, '.run.json.tmp'), 'utf8'))).toEqual(runRecord());
    await expect(readFile(path.join(storage.runDirectory, 'run.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (code === 'EIO') expect(rename).toHaveBeenCalledTimes(1);
    else expect(vi.mocked(rename).mock.calls.length).toBeLessThanOrEqual(6);
  });
});

/** Creates one independent storage root without starting the Product Runtime. */
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'megumi-sealing-'));
  roots.push(root);
  return createRunStorage({ evaluationRoot: root, runId: 'run.storage' });
}
function runRecord() {
  return EvaluationRunRecordSchema.parse({ schemaVersion: 2, runId: 'run.storage', status: 'completed',
    startedAt: '2026-09-06T00:00:00Z', endedAt: '2026-09-06T00:00:01Z',
    candidateModel: { source: 'explicit', providerId: 'test', modelId: 'test', api: 'openai-completions', baseUrl: 'https://example.test', contextWindowTokens: 1000, maxOutputTokens: 100 },
    selection: { datasets: [], directCaseIds: [] },
    runtime: { productVersion: 'test', nodeVersion: 'test', platform: 'test', architecture: 'test', safetyWallClockLimitMs: 1000 }, caseRuns: [] });
}
