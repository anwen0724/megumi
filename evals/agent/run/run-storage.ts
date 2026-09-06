/*
 * Owns append-only Evaluation Run directories and atomically seals complete Case records.
 */
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CaseRunResultSchema,
  CaseSnapshotSchema,
  EvaluationRunRecordSchema,
  type CaseRunResult,
  type CaseSnapshot,
  type EvaluationRunRecord,
} from '../contracts/evaluation-run';
import { archiveCaseEvidence, type TraceIntegrity } from './case-record';

export interface EvaluationRunStorage {
  readonly runDirectory: string;
  writeCaseRecord(input: {
    readonly snapshot: CaseSnapshot;
    readonly result: Omit<CaseRunResult, 'artifacts'>;
    readonly initialState: unknown;
    readonly evidence: {
      readonly traceIntegrity: TraceIntegrity;
      readonly observabilityRoot?: string;
      readonly sequenceRoot?: string;
      readonly workspaceRoot?: string;
      readonly initialWorkspaceFiles?: Readonly<Record<string, string>>;
      readonly initialWorkspaceRoot?: string;
    };
  }): Promise<{ readonly result: CaseRunResult; readonly resultPath: string }>;
  writeRunRecord(record: EvaluationRunRecord): Promise<void>;
}

/** Creates a new Run directory and refuses to reuse an existing Run ID. */
export async function createRunStorage(input: {
  readonly evaluationRoot: string;
  readonly runId: string;
}): Promise<EvaluationRunStorage> {
  const recordsRoot = path.join(path.resolve(input.evaluationRoot), 'records');
  await mkdir(recordsRoot, { recursive: true });
  const runDirectory = path.join(recordsRoot, input.runId);
  await mkdir(runDirectory);
  await mkdir(path.join(runDirectory, 'cases'));

  return {
    runDirectory,
    async writeCaseRecord(recordInput) {
      const snapshot = CaseSnapshotSchema.parse(recordInput.snapshot);
      const caseRunId = recordInput.result.caseRunId;
      const casesRoot = path.join(runDirectory, 'cases');
      const draftDirectory = path.join(casesRoot, `.${caseRunId}.draft`);
      const finalDirectory = path.join(casesRoot, caseRunId);
      if (await pathExists(draftDirectory) || await pathExists(finalDirectory)) {
        throw new Error(`Case Run record already exists: ${caseRunId}.`);
      }
      await mkdir(draftDirectory);
      await writeJson(path.join(draftDirectory, 'case.json'), snapshot);
      await writeJson(path.join(draftDirectory, 'initial-state.json'), toJsonSafe(recordInput.initialState));
      let resultInput: Omit<CaseRunResult, 'artifacts'> = recordInput.result;
      let artifacts: CaseRunResult['artifacts'] = { files: [], initialFiles: [], deletedFiles: [] };
      try {
        artifacts = await archiveCaseEvidence({
          destination: draftDirectory,
          ...(recordInput.evidence.sequenceRoot ? { sequenceRoot: recordInput.evidence.sequenceRoot } : {}),
          traceIntegrity: recordInput.evidence.traceIntegrity,
          ...(recordInput.evidence.observabilityRoot
            ? { observabilityRoot: recordInput.evidence.observabilityRoot }
            : {}),
          ...(recordInput.evidence.workspaceRoot ? { workspaceRoot: recordInput.evidence.workspaceRoot } : {}),
          ...(recordInput.evidence.initialWorkspaceFiles
            ? { initialWorkspaceFiles: recordInput.evidence.initialWorkspaceFiles }
            : {}),
          ...(recordInput.evidence.initialWorkspaceRoot ? { initialWorkspaceRoot: recordInput.evidence.initialWorkspaceRoot } : {}),
        });
      } catch (error) {
        resultInput = {
          ...recordInput.result,
          recordStatus: 'infrastructure_failed',
          issues: [...recordInput.result.issues, { phase: 'archive', message: errorRecord(error).message }],
        };
      }
      const result = CaseRunResultSchema.parse(toJsonSafe({ ...resultInput, artifacts }));
      await writeJson(path.join(draftDirectory, 'result.json'), result);
      await sealByRename(draftDirectory, finalDirectory);
      return {
        result,
        resultPath: path.posix.join('cases', caseRunId, 'result.json'),
      };
    },
    async writeRunRecord(record) {
      const parsed = EvaluationRunRecordSchema.parse(record);
      const finalPath = path.join(runDirectory, 'run.json');
      const temporaryPath = path.join(runDirectory, '.run.json.tmp');
      if (await pathExists(finalPath) || await pathExists(temporaryPath)) {
        throw new Error(`Evaluation Run record already exists: ${input.runId}.`);
      }
      await writeJson(temporaryPath, parsed);
      await sealByRename(temporaryPath, finalPath);
    },
  };
}

/** Retries short-lived filesystem locks without rebuilding evidence or replacing a published record. */
async function sealByRename(draft: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    if (await pathExists(destination)) throw new Error(`Evaluation record already exists: ${destination}.`);
    try {
      await rename(draft, destination);
      return;
    } catch (error) {
      const transient = error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EBUSY');
      if (!transient || attempt >= 5) throw error;
      // Windows scanners can briefly hold a freshly written archive; the original draft stays intact.
      await delay(50 * (attempt + 1));
    }
  }
}

function errorRecord(error: unknown): { readonly name: string; readonly message: string } {
  return error instanceof Error
    ? { name: error.name || 'Error', message: error.message }
    : { name: 'Error', message: String(error) };
}

function toJsonSafe(value: unknown): unknown {
  const redacted = redactSecrets(value);
  const serialized = JSON.stringify(redacted);
  if (serialized === undefined) return null;
  const parsed: unknown = JSON.parse(serialized);
  return parsed;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /^(?:api[_-]?key|authorization|cookie|password|secret|access[_-]?token|refresh[_-]?token)$/iu.test(key)
      ? '[REDACTED]'
      : redactSecrets(child),
  ]));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}
