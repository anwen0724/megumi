/*
 * Resolves authored Dataset files, validates their references, and computes stable digests.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EvaluationCaseSchema,
  EvaluationDatasetManifestSchema,
  type EvaluationCase,
  type EvaluationDatasetManifest,
  type EvaluationEnvironmentKind,
} from '../contracts/evaluation-dataset';

const MAX_CASE_BYTES = 2 * 1024 * 1024;
const CREDENTIAL_PATTERNS = [
  /\b(?:sk|ghp|xox[baprs])-[a-z0-9_-]{12,}\b/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
] as const;

export interface ResolvedEvaluationCase {
  readonly identity: string;
  readonly environmentKind: EvaluationEnvironmentKind;
  readonly case: EvaluationCase;
  readonly digest: string;
  readonly resources: Readonly<Record<string, string>>;
  readonly memberships: readonly string[];
}

export interface ResolvedEvaluationDataset {
  readonly identity: string;
  readonly manifest: EvaluationDatasetManifest;
  readonly digest: string;
  readonly cases: readonly ResolvedEvaluationCase[];
}

/** Loads one explicit Dataset and every referenced Case as one validated value. */
export async function loadDataset(input: {
  readonly rootDirectory: string;
  readonly identity: string;
}): Promise<ResolvedEvaluationDataset> {
  const identity = parseIdentity(input.identity, 'Dataset');
  const environmentRoot = path.join(path.resolve(input.rootDirectory), identity.environmentKind);
  const manifestPath = path.join(environmentRoot, 'manifests', `${identity.localId}.json`);
  const manifest = EvaluationDatasetManifestSchema.parse(await readJson(manifestPath));
  if (manifest.environmentKind !== identity.environmentKind || manifest.datasetId !== identity.localId) {
    throw new Error(`Dataset identity does not match its path: ${input.identity}.`);
  }
  const catalog = await loadCaseCatalog(environmentRoot, identity.environmentKind);
  const datasetIdentity = formatIdentity(identity.environmentKind, manifest.datasetId);
  const cases = (await Promise.all(manifest.caseIds.map(async (caseId) => {
    const evaluationCase = catalog.get(caseId);
    if (!evaluationCase) throw new Error(`Dataset ${datasetIdentity} references missing Case ${caseId}.`);
    const resolved = await resolveCase(environmentRoot, identity.environmentKind, evaluationCase);
    return { ...resolved, memberships: [datasetIdentity] };
  }))).sort((left, right) => left.identity.localeCompare(right.identity));
  return {
    identity: datasetIdentity,
    manifest,
    cases,
    digest: digestValue({
      manifest: { ...manifest, caseIds: [...manifest.caseIds].sort() },
      cases: cases.map(({ identity: caseIdentity, digest }) => ({ identity: caseIdentity, digest }))
        .sort((left, right) => left.identity.localeCompare(right.identity)),
    }),
  };
}

/** Loads one Case by its environment-qualified stable identity. */
export async function loadCase(input: {
  readonly rootDirectory: string;
  readonly identity: string;
}): Promise<ResolvedEvaluationCase> {
  const identity = parseIdentity(input.identity, 'Case');
  const environmentRoot = path.join(path.resolve(input.rootDirectory), identity.environmentKind);
  const catalog = await loadCaseCatalog(environmentRoot, identity.environmentKind);
  const evaluationCase = catalog.get(identity.localId);
  if (!evaluationCase) throw new Error(`Case was not found: ${input.identity}.`);
  return resolveCase(environmentRoot, identity.environmentKind, evaluationCase);
}

/** Validates every authored Dataset and Case reachable from the Dataset root. */
export async function validateDatasets(input: {
  readonly rootDirectory: string;
}): Promise<{
  readonly datasetCount: number;
  readonly caseCount: number;
  readonly warnings: readonly string[];
}> {
  const identities: string[] = [];
  const caseIdentities = new Set<string>();
  for (const environmentKind of ['controlled', 'live'] as const) {
    const environmentRoot = path.join(path.resolve(input.rootDirectory), environmentKind);
    const catalog = await loadCaseCatalog(environmentRoot, environmentKind);
    for (const caseId of catalog.keys()) caseIdentities.add(formatIdentity(environmentKind, caseId));
    const manifestDirectory = path.join(environmentRoot, 'manifests');
    for (const file of await jsonFiles(manifestDirectory)) {
      identities.push(formatIdentity(environmentKind, path.basename(file, '.json')));
    }
  }
  const datasets = await Promise.all(identities.map((identity) => loadDataset({ ...input, identity })));
  const referenced = new Set(datasets.flatMap((dataset) => dataset.cases.map((entry) => entry.identity)));
  const warnings = [...caseIdentities]
    .filter((identity) => !referenced.has(identity))
    .sort()
    .map((identity) => `Case ${identity} is not referenced by any Dataset.`);
  return { datasetCount: identities.length, caseCount: caseIdentities.size, warnings };
}

async function loadCaseCatalog(
  environmentRoot: string,
  environmentKind: EvaluationEnvironmentKind,
): Promise<ReadonlyMap<string, EvaluationCase>> {
  const catalog = new Map<string, EvaluationCase>();
  const typeDirectories = await directoryNames(path.join(environmentRoot, 'cases'));
  for (const typeDirectory of typeDirectories) {
    for (const file of await jsonFiles(path.join(environmentRoot, 'cases', typeDirectory))) {
      const rawCase = await readJson(file);
      assertSafeCaseContent(rawCase, file);
      const evaluationCase = EvaluationCaseSchema.parse(rawCase);
      if (
        environmentKind === 'controlled'
        && evaluationCase.type === 'candidate_supply'
        && evaluationCase.initialState.controlledSources.length === 0
      ) {
        throw new Error(`Controlled Candidate Supply Case requires at least one controlled source: ${evaluationCase.caseId}.`);
      }
      if (catalog.has(evaluationCase.caseId)) throw new Error(`Duplicate Case ID in ${environmentKind}: ${evaluationCase.caseId}.`);
      if (typeDirectory !== evaluationCase.type.replaceAll('_', '-')) {
        throw new Error(`Case ${evaluationCase.caseId} is stored under the wrong business directory.`);
      }
      catalog.set(evaluationCase.caseId, evaluationCase);
    }
  }
  return catalog;
}

async function resolveCase(
  environmentRoot: string,
  environmentKind: EvaluationEnvironmentKind,
  evaluationCase: EvaluationCase,
): Promise<ResolvedEvaluationCase> {
  const resources: Record<string, string> = {};
  if (evaluationCase.type === 'conversation') {
    for (const file of evaluationCase.initialState.workspaceFiles) {
      if (!('assetPath' in file)) continue;
      const assetFile = resolveInside(path.join(environmentRoot, 'assets'), file.assetPath);
      const actualChecksum = sha256(await readFile(assetFile));
      if (actualChecksum !== file.checksum) throw new Error(`Asset checksum mismatch: ${file.assetPath}.`);
      resources[file.assetPath] = actualChecksum;
    }
  }
  return {
    identity: formatIdentity(environmentKind, evaluationCase.caseId),
    environmentKind,
    case: evaluationCase,
    digest: digestValue({ case: evaluationCase, resources }),
    resources,
    memberships: [],
  };
}

function parseIdentity(value: string, label: string): {
  readonly environmentKind: EvaluationEnvironmentKind;
  readonly localId: string;
} {
  const match = /^(controlled|live)\/([a-z0-9]+(?:[._-][a-z0-9]+)*)$/u.exec(value);
  const localId = match?.[2];
  if (!match || !localId) throw new Error(`${label} identity must be controlled/<id> or live/<id>.`);
  return { environmentKind: match[1] === 'controlled' ? 'controlled' : 'live', localId };
}

function formatIdentity(environmentKind: EvaluationEnvironmentKind, localId: string): string {
  return `${environmentKind}/${localId}`;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read Evaluation JSON ${file}: ${errorMessage(error)}`, { cause: error });
  }
}

async function directoryNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
}

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
}

function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Dataset path escapes its root: ${relativePath}.`);
  return target;
}

function digestValue(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function assertSafeCaseContent(value: unknown, sourceFile: string): void {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_CASE_BYTES) {
    throw new Error(`Evaluation Case exceeds the ${MAX_CASE_BYTES} byte limit: ${sourceFile}.`);
  }
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(encoded))) {
    throw new Error(`Credential-like secret found in Evaluation Case: ${sourceFile}.`);
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Evaluation digest input is not JSON serializable.');
  return serialized;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
