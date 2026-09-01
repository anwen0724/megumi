/* Persists one complete Evaluation Run beneath its isolated artifact directory. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface EvaluationRunStorage {
  readonly runDirectory: string;
  taskDirectory(taskRunId: string): string;
  writeManifest(manifest: unknown): Promise<void>;
  writeEvidence(taskRunId: string, evidence: unknown): Promise<string>;
  writeResult(result: unknown): Promise<string>;
  writeBaselineComparison(comparison: unknown): Promise<string>;
  writeReport(content: string): Promise<string>;
}

export async function createRunStorage(root: string, runId: string): Promise<EvaluationRunStorage> {
  const runDirectory = path.join(path.resolve(root), 'runs', safeSegment(runId));
  await mkdir(runDirectory, { recursive: true });
  return {
    runDirectory,
    taskDirectory: (taskRunId) => path.join(runDirectory, 'tasks', safeSegment(taskRunId)),
    writeManifest: (manifest) => writeJson(path.join(runDirectory, 'manifest.json'), manifest),
    async writeEvidence(taskRunId, evidence) {
      const file = path.join(runDirectory, 'evidence', `${safeSegment(taskRunId)}.json`);
      await writeJson(file, evidence);
      return file;
    },
    async writeResult(result) {
      const file = path.join(runDirectory, 'result.json');
      await writeJson(file, result);
      return file;
    },
    async writeBaselineComparison(comparison) {
      const file = path.join(runDirectory, 'baseline-comparison.json');
      await writeJson(file, comparison);
      return file;
    },
    async writeReport(content) {
      const file = path.join(runDirectory, 'report.md');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
      return file;
    },
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9._:-]+$/u.test(value)) throw new Error(`Unsafe Evaluation artifact identifier: ${value}.`);
  return value.replaceAll(':', '_');
}
