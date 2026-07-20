/* Reads repository and fixture state without invoking Agent tools or product runtime. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest } from '../runner/evaluation-fingerprint';

const execFileAsync = promisify(execFile);

export interface EvaluationSourceState {
  sourceRevision: string;
  sourceDirty: boolean;
}

export async function readGitSourceState(repositoryRoot: string): Promise<EvaluationSourceState> {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }),
    execFileAsync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repositoryRoot, encoding: 'utf8' }),
  ]);
  return { sourceRevision: revision.trim(), sourceDirty: status.trim().length > 0 };
}

export async function fingerprintDirectory(directoryPath: string): Promise<{ digest: string; fileCount: number }> {
  const files = await listFiles(directoryPath);
  const entries = await Promise.all(files.map(async (filePath) => ({
    path: path.relative(directoryPath, filePath).replace(/\\/g, '/'),
    digest: canonicalDigest(await readFile(filePath)),
  })));
  return { digest: canonicalDigest(entries), fileCount: entries.length };
}

async function listFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directoryPath, entry.name);
    return entry.isDirectory() ? listFiles(target) : entry.isFile() ? [target] : [];
  }));
  return nested.flat().sort();
}
