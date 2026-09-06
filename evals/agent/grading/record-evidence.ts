/*
 * Loads sealed Run evidence and maps its archive layout to the existing read-only Trace reader.
 */
import { digest } from '../evidence-digest';
export { digest } from '../evidence-digest';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createTraceReader, nodeObservabilityStorage, type ObservabilityPersistenceStorage,
  type TraceMeasurements, type TraceProjection } from '@megumi/observability';
import { CaseRunResultSchema, CaseSnapshotSchema, EvaluationRunRecordSchema } from '../contracts/evaluation-run';

export interface CaseEvidence {
  readonly snapshot: z.infer<typeof CaseSnapshotSchema>;
  readonly result: z.infer<typeof CaseRunResultSchema>;
  readonly initialState: unknown;
  readonly evidenceDigest: string;
  readonly traceMetrics: readonly TraceMeasurements[];
  readonly traces: readonly TraceProjection[];
  readonly traceError?: string;
}

/** Rejects overlapping output so reporting cannot modify any input record. */
export async function requireSeparateOutput(outputDirectory: string, inputDirectories: readonly string[]): Promise<string> {
  const output = path.resolve(outputDirectory);
  const parent = await realpath(path.dirname(output));
  const actual = path.join(parent, path.basename(output));
  for (const input of inputDirectories) {
    const source = await realpath(input);
    if (inside(source, actual) || inside(actual, source)) throw new Error('Output must not overlap an input directory.');
  }
  try { await lstat(actual); }
  catch (error) { if (missing(error)) return actual; throw error; }
  throw new Error('Output directory already exists.');
}

/** Reads schema-validated records and checks cross-record identity before any report is created. */
export async function loadRunEvidence(runDirectory: string) {
  const root = await realpath(runDirectory);
  for (const entry of ['run.json', 'cases']) {
    if ((await lstat(path.join(root, entry))).isSymbolicLink()) throw new Error('Symbolic links are not allowed inside Run evidence.');
  }
  const run = EvaluationRunRecordSchema.parse(await readJson(path.join(root, 'run.json')));
  const seen = new Set<string>();
  const cases: CaseEvidence[] = [];
  for (const entry of run.caseRuns) {
    if (seen.has(entry.caseIdentity)) throw new Error('Duplicate Case identity in Run.');
    seen.add(entry.caseIdentity);
    const expectedPath = path.posix.join('cases', entry.caseRunId, 'result.json');
    if (entry.resultPath !== expectedPath) throw new Error('Case result path must stay inside its fixed Case directory.');
    const caseRoot = path.join(root, 'cases', entry.caseRunId);
    const files = await filesInside(caseRoot);
    const snapshot = CaseSnapshotSchema.parse(await readJson(path.join(caseRoot, 'case.json')));
    const result = CaseRunResultSchema.parse(await readJson(path.join(caseRoot, 'result.json')));
    const initialState = await readJson(path.join(caseRoot, 'initial-state.json'));
    if (snapshot.identity !== entry.caseIdentity || result.caseIdentity !== entry.caseIdentity
      || result.caseRunId !== entry.caseRunId || result.caseType !== snapshot.case.type
      || snapshot.revision !== snapshot.case.revision || snapshot.identity !== snapshot.environmentKind + '/' + snapshot.case.caseId
      || entry.recordStatus !== result.recordStatus || digest(result.candidateModel) !== digest(run.candidateModel)) {
      throw new Error('Run, Case and result identity do not match.');
    }
    if (digest({ case: snapshot.case, resources: snapshot.resources }) !== snapshot.digest) throw new Error('Case snapshot digest mismatch.');
    const fingerprints = await Promise.all(files.filter((file) => path.basename(file) !== 'cleanup.json').map(async (file) => ({
      path: path.relative(caseRoot, file).replaceAll('\\', '/'), digest: hash(await readFile(file)),
    })));
    const traceMetrics: TraceMeasurements[] = [];
    const traces: TraceProjection[] = [];
    let traceError: string | undefined;
    try {
      const reader = createArchiveReader(path.join(caseRoot, 'traces'));
      const allIds = new Set<string>();
      for (let offset = 0; ; offset += 200) {
        const page = await reader.listTraces({ offset, limit: 200 });
        for (const summary of page) {
          if (allIds.has(summary.traceId)) throw new Error('Repeated Trace page.');
          allIds.add(summary.traceId);
          const trace = await reader.getTrace(summary.traceId);
          // A Case may contain prerequisite Conversation work; do not charge it to Preference/Interest quality metrics.
          if (!trace || (snapshot.case.type === 'preference_sequence' ? trace.traceKind !== 'preference_learning' && trace.traceKind !== 'recommendation' : trace.traceKind !== snapshot.case.type)) continue;
          const measurement = await reader.getTraceMeasurements(summary.traceId);
          if (!measurement) throw new Error('Trace measurements unavailable.');
          traces.push(trace);
          traceMetrics.push(measurement);
        }
        if (page.length < 200) break;
      }
      if (allIds.size !== result.traceIntegrity.traceCount) throw new Error('Archived Trace count differs from sealed manifest.');
      if (result.traceIntegrity.targets.some((target) => target.matchedTraceIds.some((id) => !allIds.has(id)))) {
        throw new Error('Required Trace missing from archive.');
      }
    } catch (error) { traceError = error instanceof Error ? error.message : String(error); }
    cases.push({ snapshot, result, initialState, evidenceDigest: digest(fingerprints), traces, traceMetrics,
      ...(traceError ? { traceError } : {}) });
  }
  if (!cases.length) throw new Error('Run contains no Cases.');
  return { run, cases, runDigest: digest(run) };
}

/** Writes derived artifacts only into a new caller-selected directory. */
export async function writeReportFiles(directory: string, files: Readonly<Record<string, unknown>>): Promise<void> {
  await mkdir(directory);
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
      { encoding: 'utf8', flag: 'wx' });
  }
}

/** Reads JSON as unknown; its owning contract validates the result. */
export async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Preserves the authoritative Trace/content decoders while forbidding archive writes. */
function createArchiveReader(root: string) {
  const mapped = (target: string): string => {
    const relative = path.relative(root, target);
    if (!inside(root, target)) throw new Error('Trace path outside archive.');
    const segments = relative.split(path.sep);
    if (segments[0] === 'traces') segments[0] = 'journal';
    return path.join(root, ...segments);
  };
  const denyWrite = async (): Promise<never> => { throw new Error('Evaluation archive is read-only.'); };
  const storage: ObservabilityPersistenceStorage = {
    ensureDirectory: denyWrite, appendText: denyWrite, writeBytes: denyWrite, move: denyWrite, removeFile: denyWrite,
    readText: (file) => nodeObservabilityStorage.readText(mapped(file)),
    readBytes: (file) => nodeObservabilityStorage.readBytes(mapped(file)),
    readBytesRange: (file, offset, length) => nodeObservabilityStorage.readBytesRange(mapped(file), offset, length),
    listEntries: (directory) => nodeObservabilityStorage.listEntries(mapped(directory)),
    stat: (file) => nodeObservabilityStorage.stat(mapped(file)),
  };
  return createTraceReader({ rootDirectory: root, storage });
}

/** Rejects symlinks/junctions before loading untrusted paths or fingerprinting evidence. */
async function filesInside(root: string): Promise<string[]> {
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed inside Run evidence.');
  if (info.isFile()) return [root];
  if (!info.isDirectory()) throw new Error('Unsupported evidence entry.');
  const files: string[] = [];
  for (const entry of (await readdir(root)).sort()) files.push(...await filesInside(path.join(root, entry)));
  return files;
}
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
