/* Cleans oldest complete unpinned Evaluation Runs by age and total byte limit. */
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const PinnedBaselineReferenceSchema = z.object({ pinnedRunId: z.string().optional() }).passthrough();
const CompleteRunManifestSchema = z.object({ runId: z.string().min(1) }).passthrough();

export async function cleanEvaluationRuns(input: {
  readonly evaluationRoot: string;
  readonly nowMs?: number;
  readonly maxAgeMs?: number;
  readonly maxBytes?: number;
}): Promise<{ readonly removedRunIds: readonly string[]; readonly retainedBytes: number }> {
  const runsRoot = path.join(input.evaluationRoot, 'runs');
  const pinned = await readPinnedRuns(path.join(input.evaluationRoot, 'baselines'));
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const runs = (await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = path.join(runsRoot, entry.name);
    const manifest = await readManifest(directory);
    return manifest ? { id: manifest.runId, directory, modifiedAtMs: (await stat(directory)).mtimeMs, bytes: await directoryBytes(directory) } : undefined;
  }))).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).sort((left, right) => left.modifiedAtMs - right.modifiedAtMs);
  const removedRunIds: string[] = [];
  let retainedBytes = runs.reduce((total, run) => total + run.bytes, 0);
  const nowMs = input.nowMs ?? Date.now();
  for (const run of runs) {
    if (pinned.has(run.id)) continue;
    const expired = nowMs - run.modifiedAtMs > (input.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
    const overLimit = retainedBytes > (input.maxBytes ?? DEFAULT_MAX_BYTES);
    if (!expired && !overLimit) continue;
    await rm(run.directory, { recursive: true, force: true });
    retainedBytes -= run.bytes;
    removedRunIds.push(run.id);
  }
  return { removedRunIds, retainedBytes };
}

async function readPinnedRuns(directory: string): Promise<Set<string>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const value = PinnedBaselineReferenceSchema.parse(
        JSON.parse(await readFile(path.join(directory, entry.name), 'utf8')),
      );
      if (value.pinnedRunId) ids.add(value.pinnedRunId);
    } catch {
      // Invalid Baselines are reported by Evaluation CLI validation; cleanup remains fail-safe.
    }
  }
  return ids;
}

async function readManifest(directory: string): Promise<{ runId: string } | undefined> {
  try {
    const raw = CompleteRunManifestSchema.parse(
      JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')),
    );
    const resultExists = await stat(path.join(directory, 'result.json')).then(() => true).catch(() => false);
    return resultExists ? { runId: raw.runId } : undefined;
  } catch {
    return undefined;
  }
}

async function directoryBytes(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? directoryBytes(target) : entry.isFile() ? (await stat(target)).size : 0;
  }));
  return sizes.reduce((total, size) => total + size, 0);
}
