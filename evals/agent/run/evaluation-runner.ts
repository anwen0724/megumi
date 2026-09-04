/*
 * Runs validated Case selections sequentially and seals raw Product facts without evaluating quality.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Api, ProviderStreams } from '@megumi/ai';
import { z } from 'zod';
import { resolveCandidateModel, type ResolvedCandidateModel } from '../adapters/candidate-model';
import {
  EvaluationRunRecordSchema,
  EvaluationRunRequestSchema,
  type CandidateModelRecord,
  type CaseRunResult,
  type CaseSnapshot,
  type EvaluationRunRecord,
  type EvaluationRunRequest,
} from '../contracts/evaluation-run';
import { StableEvaluationIdSchema } from '../contracts/evaluation-dataset';
import {
  loadCase,
  loadDataset,
  type ResolvedEvaluationCase,
  type ResolvedEvaluationDataset,
} from '../datasets/dataset-loader';
import { collectTraceIntegrity, type TraceIntegrity } from './case-record';
import { createCaseEnvironment, type CaseEnvironment } from './case-environment';
import { CaseExecutionFailure, executeCase, type CaseExecutionResult } from './case-execution';
import { getCaseBusinessState } from './business-state';
import { createRunStorage, type EvaluationRunStorage } from './run-storage';

interface EvaluationRunnerDependencies {
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly modelStreams?: Partial<Record<Api, ProviderStreams>>;
}

/** Validates the complete selection, runs each Case in isolation, and returns the sealed Run record. */
export async function runEvaluation(input: {
  readonly repositoryRoot: string;
  readonly evaluationRoot: string;
  readonly datasetRoot: string;
  readonly request: EvaluationRunRequest;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly dependencies?: EvaluationRunnerDependencies;
}): Promise<{
  readonly record: EvaluationRunRecord;
  readonly runDirectory: string;
  readonly caseResults: readonly CaseRunResult[];
}> {
  const request = EvaluationRunRequestSchema.parse(input.request);
  const selection = await resolveSelection(input.datasetRoot, request);
  const candidateModel = await resolveCandidateModel({
    config: request.candidateModel,
    environment: input.environment ?? process.env,
  });
  const productVersion = await readProductVersion(input.repositoryRoot);
  const now = input.dependencies?.now ?? (() => new Date());
  const runId = StableEvaluationIdSchema.parse(
    input.dependencies?.createRunId?.() ?? createRunId(now()),
  );
  const startedAt = now().toISOString();
  const storage = await createRunStorage({ evaluationRoot: input.evaluationRoot, runId });
  const candidateRecord = toCandidateModelRecord(candidateModel);
  const caseResults: CaseRunResult[] = [];
  const caseRunIndexes: EvaluationRunRecord['caseRuns'][number][] = [];

  for (const resolvedCase of selection.cases) {
    const caseRunId = `${resolvedCase.environmentKind}.${resolvedCase.case.caseId}.r${resolvedCase.case.revision}`;
    const stored = await runOneCase({
      repositoryRoot: input.repositoryRoot,
      datasetRoot: input.datasetRoot,
      storage,
      resolvedCase,
      caseRunId,
      candidateModel,
      candidateRecord,
      safetyWallClockLimitMs: request.safetyWallClockLimitMs,
      now,
      ...(input.dependencies?.modelStreams ? { modelStreams: input.dependencies.modelStreams } : {}),
    });
    caseResults.push(stored.result);
    caseRunIndexes.push({
      caseRunId,
      caseIdentity: resolvedCase.identity,
      datasetMemberships: [...resolvedCase.memberships],
      recordStatus: stored.result.recordStatus,
      resultPath: stored.resultPath,
    });
  }

  const record = EvaluationRunRecordSchema.parse({
    schemaVersion: 2,
    runId,
    status: caseResults.some((result) => result.recordStatus === 'infrastructure_failed' || result.terminalState === 'interrupted')
      ? 'completed_with_failures'
      : 'completed',
    startedAt,
    endedAt: now().toISOString(),
    selection: {
      datasets: selection.datasets.map((dataset) => ({
        identity: dataset.identity,
        revision: dataset.manifest.revision,
        digest: dataset.digest,
      })),
      directCaseIds: selection.directCaseIds,
    },
    candidateModel: candidateRecord,
    runtime: {
      productVersion,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      safetyWallClockLimitMs: request.safetyWallClockLimitMs,
    },
    caseRuns: caseRunIndexes,
  });
  await storage.writeRunRecord(record);
  return { record, runDirectory: storage.runDirectory, caseResults };
}

async function runOneCase(input: {
  readonly repositoryRoot: string;
  readonly datasetRoot: string;
  readonly storage: EvaluationRunStorage;
  readonly resolvedCase: ResolvedEvaluationCase;
  readonly caseRunId: string;
  readonly candidateModel: ResolvedCandidateModel;
  readonly candidateRecord: CandidateModelRecord;
  readonly safetyWallClockLimitMs: number;
  readonly now: () => Date;
  readonly modelStreams?: Partial<Record<Api, ProviderStreams>>;
}): Promise<{ readonly result: CaseRunResult; readonly resultPath: string }> {
  const startedAt = input.now().toISOString();
  let environment: CaseEnvironment | undefined;
  let execution: CaseExecutionResult | undefined;
  let partial: CaseExecutionFailure['partial'] | undefined;
  let traceIntegrity = emptyTraceIntegrity('Case Environment did not start.');
  let finalState: CaseRunResult['finalState'] = { status: 'unavailable', message: 'Case Environment did not start.' };
  const issues: CaseRunResult['issues'] = [];
  let stopped = false;
  let initialError: ReturnType<typeof errorRecord> | undefined;
  try {
    environment = await createCaseEnvironment({
      repositoryRoot: input.repositoryRoot, datasetRoot: input.datasetRoot,
      resolvedCase: input.resolvedCase, candidateModel: input.candidateModel,
      ...(input.modelStreams ? { modelStreams: input.modelStreams } : {}),
    });
    execution = await executeCase({
      evaluationCase: input.resolvedCase.case, runtime: environment.runtime, initialStateIds: environment.initialStateIds,
      candidateModel: { providerId: input.candidateModel.config.providerId, modelId: input.candidateModel.config.modelId },
      now: environment.now, ...(environment.advanceTime ? { advanceTime: environment.advanceTime } : {}),
      safetyWallClockLimitMs: input.safetyWallClockLimitMs,
    });
  } catch (error) {
    if (error instanceof CaseExecutionFailure) partial = error.partial;
    initialError = errorRecord(error);
    issues.push({ phase: 'execution', message: initialError.message });
  }

  if (environment) {
    // A stop failure must not erase an already returned business result or permit cleanup.
    try { await environment.stop(); stopped = true; }
    catch (error) { issues.push({ phase: 'shutdown', message: errorMessage(error) }); }
    if (stopped) {
      try {
        finalState = { status: 'captured', facts: getCaseBusinessState(environment.paths.database, environment.initialStateIds.workspaceId) };
      } catch (error) {
        finalState = { status: 'unavailable', message: errorMessage(error) };
        issues.push({ phase: 'business_facts', message: errorMessage(error) });
      }
      try { traceIntegrity = await collectTraceIntegrity({ runtime: environment.runtime, targets: execution?.traceTargets ?? partial?.traceTargets ?? [] }); }
      catch (error) { traceIntegrity = emptyTraceIntegrity(errorMessage(error)); }
      try { await environment.runtime.dispose(); }
      catch (error) { stopped = false; issues.push({ phase: 'shutdown', message: errorMessage(error) }); }
    } else {
      finalState = { status: 'unavailable', message: 'Business shutdown was not confirmed; a final snapshot would be misleading.' };
      traceIntegrity = emptyTraceIntegrity('Shutdown was not confirmed; the live evidence directory is retained.');
    }
  }
  for (const message of traceIntegrity.issues) issues.push({ phase: 'trace', message });
  const resultInput: Omit<CaseRunResult, 'artifacts'> = {
    schemaVersion: 2, caseRunId: input.caseRunId, caseIdentity: input.resolvedCase.identity,
    caseType: input.resolvedCase.case.type, recordStatus: issues.length ? 'infrastructure_failed' : 'recorded',
    startedAt, endedAt: input.now().toISOString(), candidateModel: input.candidateRecord,
    environment: environment ? { ...environment.details, temporaryRoot: environment.paths.root } : { environmentKind: input.resolvedCase.environmentKind },
    businessIds: execution?.businessIds ?? partial?.businessIds ?? {}, finalState, issues, traceIntegrity,
    ...(partial ? { productResult: partial.productResult, ownerFacts: partial.ownerFacts } : {}),
    ...(execution ? { terminalState: execution.terminalState, productResult: execution.productResult, ownerFacts: execution.ownerFacts,
      ...(execution.interruption ? { interruption: execution.interruption } : {}),
    } : {}),
    ...(initialError ? { error: initialError } : {}),
  };
  // If writing or sealing fails, leave the source environment untouched for recovery.
  const stored = await input.storage.writeCaseRecord({
    snapshot: toCaseSnapshot(input.resolvedCase), result: resultInput,
    initialState: environment ? { status: 'captured', clock: input.resolvedCase.case.initialState.clock,
      references: environment.initialStateIds, facts: environment.initialState, workspaceFiles: environment.initialWorkspaceFiles,
      businessSettings: environment.details.businessSettings,
    } : { status: 'unavailable', message: initialError?.message ?? 'Initialization did not complete.' },
    evidence: {
      traceIntegrity,
      ...(environment && stopped ? { observabilityRoot: environment.paths.observability,
        workspaceRoot: environment.paths.workspace, initialWorkspaceRoot: environment.paths.initialWorkspace,
        initialWorkspaceFiles: environment.initialWorkspaceFiles,
      } : {}),
    },
  }).catch((error: unknown) => {
    const recovery = environment ? ` Retained environment: ${environment.paths.root}.` : '';
    throw new Error(`Case ${input.caseRunId} could not be sealed.${recovery} ${errorMessage(error)}`, { cause: error });
  });
  if (environment) {
    let cleanup: { status: string; path?: string; message?: string };
    if (stopped && stored.result.recordStatus === 'recorded') {
      try { await environment.dispose(); cleanup = { status: 'removed' }; }
      catch (error) { cleanup = { status: 'retained', path: environment.paths.root, message: errorMessage(error) }; }
    } else {
      cleanup = { status: 'retained', path: environment.paths.root, message: 'Incomplete capture or shutdown; kept for diagnosis.' };
    }
    // Cleanup is a separate append-only receipt: a deletion failure cannot rewrite business facts.
    await writeFile(path.join(input.storage.runDirectory, 'cases', input.caseRunId, 'cleanup.json'), JSON.stringify(cleanup, null, 2), { encoding: 'utf8', flag: 'wx' });
  }
  return stored;
}

async function resolveSelection(
  datasetRoot: string,
  request: EvaluationRunRequest,
): Promise<{
  readonly datasets: readonly ResolvedEvaluationDataset[];
  readonly directCaseIds: readonly string[];
  readonly cases: readonly ResolvedEvaluationCase[];
}> {
  const datasetIds = [...new Set(request.datasetIds)].sort();
  const directCaseIds = [...new Set(request.caseIds)].sort();
  const [datasets, directCases] = await Promise.all([
    Promise.all(datasetIds.map((identity) => loadDataset({ rootDirectory: datasetRoot, identity }))),
    Promise.all(directCaseIds.map((identity) => loadCase({ rootDirectory: datasetRoot, identity }))),
  ]);
  const cases = new Map<string, ResolvedEvaluationCase>();
  for (const dataset of datasets) {
    for (const resolvedCase of dataset.cases) mergeCase(cases, resolvedCase, dataset.identity);
  }
  for (const resolvedCase of directCases) mergeCase(cases, resolvedCase);
  return {
    datasets,
    directCaseIds,
    cases: [...cases.values()].sort((left, right) => left.identity.localeCompare(right.identity)),
  };
}

function mergeCase(
  cases: Map<string, ResolvedEvaluationCase>,
  incoming: ResolvedEvaluationCase,
  membership?: string,
): void {
  const current = cases.get(incoming.identity);
  if (current && current.digest !== incoming.digest) {
    throw new Error(`Selected Case resolved to conflicting digests: ${incoming.identity}.`);
  }
  const memberships = new Set([...(current?.memberships ?? incoming.memberships), ...(membership ? [membership] : [])]);
  cases.set(incoming.identity, {
    ...(current ?? incoming),
    memberships: [...memberships].sort(),
  });
}

function toCaseSnapshot(resolvedCase: ResolvedEvaluationCase): CaseSnapshot {
  return {
    identity: resolvedCase.identity,
    environmentKind: resolvedCase.environmentKind,
    revision: resolvedCase.case.revision,
    digest: resolvedCase.digest,
    resources: resolvedCase.resources,
    datasetMemberships: [...resolvedCase.memberships],
    case: resolvedCase.case,
  };
}

function toCandidateModelRecord(model: ResolvedCandidateModel): CandidateModelRecord {
  return {
    source: model.source,
    providerId: model.config.providerId,
    modelId: model.config.modelId,
    api: model.config.api,
    baseUrl: model.config.baseUrl,
    contextWindowTokens: model.config.contextWindowTokens,
    maxOutputTokens: model.config.maxOutputTokens,
  };
}

function emptyTraceIntegrity(issue: string): TraceIntegrity {
  return {
    status: 'incomplete', traceCount: 0, health: { unavailable: issue }, targets: [], issues: [issue],
  };
}

function errorRecord(error: unknown): { readonly name: string; readonly message: string } {
  return error instanceof Error
    ? { name: error.name || 'Error', message: error.message }
    : { name: 'Error', message: String(error) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRunId(now: Date): string {
  const timestamp = now.toISOString().replace(/[^0-9]/gu, '');
  return `run.${timestamp}.${crypto.randomUUID()}`;
}

async function readProductVersion(repositoryRoot: string): Promise<string> {
  const parsed: unknown = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  return z.object({ version: z.string().min(1) }).passthrough().parse(parsed).version;
}
