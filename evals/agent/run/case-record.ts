/*
 * Collects Trace integrity and copies only durable Trace and changed Workspace evidence into a Case Record.
 */
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductRuntime } from '@megumi/composition';
import type { CaseRunResult } from '../contracts/evaluation-run';
import type { CaseTraceTarget } from './case-execution';

export type TraceIntegrity = CaseRunResult['traceIntegrity'];
export type ArtifactManifest = CaseRunResult['artifacts'];

/** Flushes accepted Trace writes and checks every business correlation returned by the Case driver. */
export async function collectTraceIntegrity(input: {
  readonly runtime: ProductRuntime;
  readonly targets: readonly CaseTraceTarget[];
}): Promise<TraceIntegrity> {
  const issues: string[] = [];
  await input.runtime.host.observability.flush();
  const [healthResult, allTraces, ...targetResults] = await Promise.all([
    input.runtime.host.observability.getHealth({}),
    listAllTraces(input.runtime, {}),
    ...input.targets.map((target) => listAllTraces(input.runtime, { traceKind: target.traceKind, correlation: target.correlation })),
  ]);

  const health = healthResult.status === 'ok'
    ? healthResult.health
    : { unavailable: healthResult.message };
  if (healthResult.status === 'failed') issues.push(`Trace health query failed: ${healthResult.message}`);
  if (healthResult.status === 'ok' && hasTraceHealthFailure(healthResult.health)) {
    issues.push('Observability reported dropped records or persistence failures.');
  }
  if (allTraces.status === 'failed') issues.push(`Trace list failed: ${allTraces.message}`);
  const summaries = allTraces.status === 'ok' ? allTraces.traces : [];
  if (summaries.some((trace) => trace.diagnostics === 'incomplete' || trace.status === 'incomplete')) {
    issues.push('At least one stored Trace reports incomplete diagnostics.');
  }

  const targets = input.targets.map((target, index) => {
    const result = targetResults[index];
    const matchedTraceIds = result?.status === 'ok' ? result.traces.map((trace) => trace.traceId) : [];
    if (!result) issues.push(`Trace query was not executed for ${target.traceKind}.`);
    else if (result.status === 'failed') issues.push(`Trace query failed for ${target.traceKind}: ${result.message}`);
    else if (matchedTraceIds.length === 0) issues.push(`Required Trace was not found for ${target.traceKind}.`);
    return { traceKind: target.traceKind, correlation: target.correlation, matchedTraceIds };
  });

  return {
    status: issues.length === 0 ? 'complete' : 'incomplete',
    traceCount: summaries.length,
    health,
    targets,
    issues,
  };
}

/** Copies the authoritative Trace Journal/Content and changed Workspace files into a draft record. */
export async function archiveCaseEvidence(input: {
  readonly observabilityRoot?: string;
  readonly workspaceRoot?: string;
  readonly initialWorkspaceFiles?: Readonly<Record<string, string>>;
  readonly initialWorkspaceRoot?: string;
  readonly destination: string;
  readonly traceIntegrity: TraceIntegrity;
}): Promise<ArtifactManifest> {
  const tracesDestination = path.join(input.destination, 'traces');
  const artifactsDestination = path.join(input.destination, 'artifacts');
  await mkdir(tracesDestination, { recursive: true });
  await mkdir(artifactsDestination, { recursive: true });
  if (input.observabilityRoot) {
    await copyDirectoryIfPresent(
      path.join(input.observabilityRoot, 'traces'),
      path.join(tracesDestination, 'journal'),
    );
    await copyDirectoryIfPresent(
      path.join(input.observabilityRoot, 'content'),
      path.join(tracesDestination, 'content'),
    );
    await copyDirectoryIfPresent(path.join(input.observabilityRoot, 'runtime'), path.join(tracesDestination, 'runtime'));
  }
  await writeJson(path.join(tracesDestination, 'manifest.json'), input.traceIntegrity);

  const files = input.workspaceRoot
    ? await archiveChangedWorkspaceFiles({
        workspaceRoot: input.workspaceRoot,
        initialFiles: input.initialWorkspaceFiles ?? {},
        destination: path.join(artifactsDestination, 'workspace'),
      })
    : [];
  const finalPaths = input.workspaceRoot ? new Set((await listFiles(input.workspaceRoot)).map(({ relativePath }) => relativePath)) : new Set<string>();
  const deletedFiles = Object.keys(input.initialWorkspaceFiles ?? {}).filter((file) => !finalPaths.has(file)).sort();
  const initialFiles = input.initialWorkspaceRoot ? await archiveChangedWorkspaceFiles({ workspaceRoot: input.initialWorkspaceRoot, initialFiles: {}, destination: path.join(artifactsDestination, 'initial-workspace') }) : [];
  return { files, deletedFiles, initialFiles: initialFiles.map((file) => ({ ...file, path: file.path.replace(/^workspace\//u, 'initial-workspace/') })) };
}

async function listAllTraces(runtime: ProductRuntime, query: Parameters<ProductRuntime['host']['observability']['listTraces']>[0]) {
  const traces: Extract<Awaited<ReturnType<ProductRuntime['host']['observability']['listTraces']>>, { status: 'ok' }>['traces'] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += 200) {
    const result = await runtime.host.observability.listTraces({ ...query, limit: 200, offset });
    if (result.status === 'failed') return result;
    if (result.traces.some(({ traceId }) => seen.has(traceId))) return { status: 'failed' as const, message: 'Trace pagination repeated a page; capture is not stable.' };
    for (const trace of result.traces) { seen.add(trace.traceId); traces.push(trace); }
    if (result.traces.length < 200) return { status: 'ok' as const, traces };
  }
}

async function archiveChangedWorkspaceFiles(input: {
  readonly workspaceRoot: string;
  readonly initialFiles: Readonly<Record<string, string>>;
  readonly destination: string;
}): Promise<ArtifactManifest['files']> {
  const output: Array<ArtifactManifest['files'][number]> = [];
  for (const file of await listFiles(input.workspaceRoot)) {
    const bytes = await readFile(file.absolutePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (input.initialFiles[file.relativePath] === digest) continue;
    const destination = resolveInside(input.destination, file.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(file.absolutePath, destination);
    output.push({ path: `workspace/${file.relativePath}`, sha256: digest, byteLength: bytes.byteLength });
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

async function listFiles(root: string): Promise<Array<{ readonly absolutePath: string; readonly relativePath: string }>> {
  const files: Array<{ readonly absolutePath: string; readonly relativePath: string }> = [];
  await walk(root, root, files);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walk(
  root: string,
  directory: string,
  output: Array<{ readonly absolutePath: string; readonly relativePath: string }>,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, absolutePath, output);
    else if (entry.isFile()) output.push({
      absolutePath,
      relativePath: path.relative(root, absolutePath).replaceAll('\\', '/'),
    });
  }
}

async function copyDirectoryIfPresent(source: string, destination: string): Promise<void> {
  if (!await pathExists(source)) return;
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
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

function hasTraceHealthFailure(health: {
  readonly droppedRecords: number;
  readonly journalWriteFailures: number;
  readonly contentWriteFailures: number;
  readonly flushFailures: number;
  readonly rotationFailures: number;
  readonly retentionCleanupFailures: number;
  readonly indexProjectionFailures: number;
  readonly classifierFailures: number;
  readonly contextFailures: number;
  readonly captureFailures: number;
}): boolean {
  return health.droppedRecords > 0
    || health.journalWriteFailures > 0
    || health.contentWriteFailures > 0
    || health.flushFailures > 0
    || health.rotationFailures > 0
    || health.retentionCleanupFailures > 0
    || health.indexProjectionFailures > 0
    || health.classifierFailures > 0
    || health.contextFailures > 0
    || health.captureFailures > 0;
}

function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Artifact path escapes its root: ${relativePath}.`);
  }
  return target;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
