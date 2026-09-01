/* Orchestrates Case isolation, Product lifecycle, Evidence, grading, and partial failure. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluationCapabilityDirectory, type EvaluationCase } from '../catalog/evaluation-case';
import type { EvaluationCatalog } from '../catalog/evaluation-catalog';
import type { EvaluationRunConfig } from '../catalog/evaluation-run-config';
import { candidateSupplyEvaluation } from '../capabilities/candidate-supply/candidate-supply-evaluation';
import { conversationEvaluation } from '../capabilities/conversation/conversation-evaluation';
import { dailyRecommendationEvaluation } from '../capabilities/daily-recommendation/daily-recommendation-evaluation';
import { interestUnderstandingEvaluation } from '../capabilities/interest-understanding/interest-understanding-evaluation';
import { preferenceLearningEvaluation } from '../capabilities/preference-learning/preference-learning-evaluation';
import { composeEvaluationCase, type ComposedEvaluationCase } from './evaluation-composition';
import { collectEvidence, type CapabilityEvaluation } from './evidence';
import { gradeHardGates } from './grading';
import type { ModelGrader } from './model-grader';
import { createRunBudget } from './run-budget';
import { createRunStorage, type EvaluationRunStorage } from './run-storage';
import {
  CaseEvaluationResultSchema,
  EvaluationRunResultSchema,
  type CaseEvaluationResult,
  type EvaluationRunResult,
} from './evaluation-result';

const capabilityEvaluations: Readonly<Record<EvaluationCase['capability'], CapabilityEvaluation>> = {
  conversation: conversationEvaluation as CapabilityEvaluation,
  interest_understanding: interestUnderstandingEvaluation as CapabilityEvaluation,
  candidate_supply: candidateSupplyEvaluation as CapabilityEvaluation,
  daily_recommendation: dailyRecommendationEvaluation as CapabilityEvaluation,
  preference_learning: preferenceLearningEvaluation as CapabilityEvaluation,
};

export interface EvaluationRunnerDependencies {
  readonly modelGrader: ModelGrader;
  readonly composeCase?: typeof composeEvaluationCase;
  readonly now?: () => Date;
  readonly createRunId?: () => string;
}

export async function runEvaluation(input: {
  readonly repositoryRoot: string;
  readonly catalog: EvaluationCatalog;
  readonly config: EvaluationRunConfig;
  readonly dependencies: EvaluationRunnerDependencies;
}): Promise<{ readonly result: EvaluationRunResult; readonly storage: EvaluationRunStorage }> {
  const now = input.dependencies.now ?? (() => new Date());
  const runId = input.dependencies.createRunId?.() ?? `run:${crypto.randomUUID()}`;
  const startedAt = now().toISOString();
  const productVersion = await readProductVersion(input.repositoryRoot);
  const storage = await createRunStorage(input.config.runRoot, runId);
  const scheduled = resolveCases(input.catalog, input.config);
  await storage.writeManifest({
    runId,
    startedAt,
    profile: input.config.profile,
    suiteIds: input.config.suiteIds,
    candidateModel: publicModel(input.config.candidateModel),
    graderModel: publicModel(input.config.graderModel),
    repetitions: input.config.repetitions,
    concurrency: input.config.concurrency,
    budget: input.config.budget,
    productVersion,
  });
  const budget = createRunBudget(input.config.budget);
  const results: CaseEvaluationResult[] = new Array(scheduled.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(input.config.concurrency, scheduled.length) }, async () => {
    while (cursor < scheduled.length) {
      const index = cursor++;
      const scheduledCase = scheduled[index];
      if (!budget.canStartCase()) {
        results[index] = budgetBlockedResult(scheduledCase, input.config.profile, now().toISOString());
        continue;
      }
      results[index] = await runCase({ ...input, storage, runId, scheduledCase, now });
      budget.record(results[index].measurements);
    }
  });
  await Promise.all(workers);
  const result = EvaluationRunResultSchema.parse({
    runId,
    profile: input.config.profile,
    startedAt,
    endedAt: now().toISOString(),
    candidateModel: `${input.config.candidateModel.providerId}/${input.config.candidateModel.modelId}`,
    graderModelAndRuleVersion: `${input.config.graderModel.providerId}/${input.config.graderModel.modelId}@semantic-dimension-0-4-v1`,
    environment: {
      productVersion,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      suiteIds: input.config.suiteIds,
      repetitions: input.config.repetitions,
      concurrency: input.config.concurrency,
    },
    caseResults: results,
    totals: totals(results),
  });
  await storage.writeResult(result);
  return { result, storage };
}

async function runCase(input: {
  readonly repositoryRoot: string;
  readonly config: EvaluationRunConfig;
  readonly dependencies: EvaluationRunnerDependencies;
  readonly storage: EvaluationRunStorage;
  readonly runId: string;
  readonly scheduledCase: ScheduledCase;
  readonly now: () => Date;
}): Promise<CaseEvaluationResult> {
  const { evaluationCase, caseRunId } = input.scheduledCase;
  const startedAt = input.now().toISOString();
  const startedAtMs = Date.now();
  let composed: ComposedEvaluationCase | undefined;
  try {
    composed = await (input.dependencies.composeCase ?? composeEvaluationCase)({
      repositoryRoot: input.repositoryRoot,
      runConfig: input.config,
      fixturePath: path.join(
        input.repositoryRoot,
        'evals', 'agent', 'fixtures', evaluationCapabilityDirectory(evaluationCase.capability),
        `${evaluationCase.setup.fixtureId}.json`,
      ),
      caseRoot: input.storage.caseDirectory(caseRunId),
    });
    const execution = await capabilityEvaluations[evaluationCase.capability].execute({
      evaluationCase,
      runConfig: input.config,
      runtime: composed.runtime,
      fixtureIds: composed.fixtureIds,
      environment: composed.environment,
      now: () => composed?.fixture.clock ?? input.now().toISOString(),
    });
    const evidence = await collectEvidence({
      evidenceId: `evidence:${caseRunId}`,
      evaluationCase,
      runtime: composed.runtime,
      execution,
      environment: composed.environment,
      startedAtMs,
      collectedAt: input.now().toISOString(),
    });
    const evidencePath = await input.storage.writeEvidence(caseRunId, evidence);
    const deterministic = gradeHardGates({ evaluationCase, evidence, now: input.now().toISOString() });
    const semantic = await input.dependencies.modelGrader.grade({
      evaluationCase,
      evidence,
      now: input.now().toISOString(),
    });
    const grades = [...deterministic, ...semantic.grades];
    const measurements = {
      ...evidence.measurements,
      graderModelCalls: semantic.usage.modelCalls,
      graderInputTokens: semantic.usage.inputTokens,
      graderOutputTokens: semantic.usage.outputTokens,
      graderEstimatedCostUsd: semantic.usage.estimatedCostUsd,
    };
    return CaseEvaluationResultSchema.parse({
      caseRunId,
      caseId: evaluationCase.caseId,
      revision: evaluationCase.revision,
      capability: evaluationCase.capability,
      profile: input.config.profile,
      status: deriveStatus(evaluationCase, grades, evidence.issues),
      startedAt,
      endedAt: input.now().toISOString(),
      evidencePath,
      grades,
      requiredDimensions: evaluationCase.grading.requiredDimensions,
      measurementLimits: evaluationCase.grading.measurementLimits,
      measurements,
      evidenceIssues: evidence.issues,
    });
  } catch (error) {
    return CaseEvaluationResultSchema.parse({
      caseRunId,
      caseId: evaluationCase.caseId,
      revision: evaluationCase.revision,
      capability: evaluationCase.capability,
      profile: input.config.profile,
      status: 'evaluation_error',
      startedAt,
      endedAt: input.now().toISOString(),
      grades: [],
      measurements: emptyMeasurements(Math.max(0, Date.now() - startedAtMs)),
      error: { code: 'evaluation_execution_failed', message: error instanceof Error ? error.message : String(error) },
    });
  } finally {
    await composed?.dispose().catch(() => undefined);
  }
}

interface ScheduledCase { readonly evaluationCase: EvaluationCase; readonly caseRunId: string }
function resolveCases(catalog: EvaluationCatalog, config: EvaluationRunConfig): ScheduledCase[] {
  const uniqueCases = new Map<string, EvaluationCase>();
  for (const suiteId of config.suiteIds) {
    for (const evaluationCase of catalog.resolveSuite(suiteId).cases) {
      uniqueCases.set(evaluationCase.caseId, evaluationCase);
    }
  }
  const cases = [...uniqueCases.values()];
  return Array.from({ length: config.repetitions }, (_, repetition) => cases.map((evaluationCase) => ({
    evaluationCase,
    caseRunId: `${evaluationCase.caseId}:r${repetition + 1}`,
  }))).flat();
}

function deriveStatus(
  evaluationCase: EvaluationCase,
  grades: readonly import('./grading').GraderResult[],
  issues: readonly { readonly impact: string }[],
): CaseEvaluationResult['status'] {
  if (grades.some((grade) => grade.grader === 'deterministic' && grade.judgement === 'fail')) return 'failed';
  for (const dimension of evaluationCase.grading.requiredDimensions) {
    const grade = grades.find((entry) => entry.dimension === dimension && entry.grader === 'model');
    if (!grade || grade.judgement === 'not_gradable') return 'not_gradable';
    if ((grade.score ?? 0) < 3) return 'failed';
  }
  if (issues.some((issue) => issue.impact === 'not_gradable')) return 'not_gradable';
  return 'passed';
}

function budgetBlockedResult(
  entry: ScheduledCase,
  profile: EvaluationRunConfig['profile'],
  at: string,
): CaseEvaluationResult {
  return CaseEvaluationResultSchema.parse({
    caseRunId: entry.caseRunId,
    caseId: entry.evaluationCase.caseId,
    revision: entry.evaluationCase.revision,
    capability: entry.evaluationCase.capability,
    profile,
    status: 'budget_blocked',
    startedAt: at,
    endedAt: at,
    grades: [],
    measurements: emptyMeasurements(0),
  });
}

function emptyMeasurements(durationMs: number) {
  return {
    durationMs, inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0,
    sourceCalls: 0, retries: 0, candidatesProduced: 0, recommendationsPublished: 0,
    preferenceRevisions: 0,
    estimatedCostUsd: 0,
    graderModelCalls: 0,
    graderInputTokens: 0,
    graderOutputTokens: 0,
    graderEstimatedCostUsd: 0,
  };
}

function totals(results: readonly CaseEvaluationResult[]) {
  return {
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    notGradable: results.filter((result) => result.status === 'not_gradable').length,
    evaluationErrors: results.filter((result) => result.status === 'evaluation_error').length,
    budgetBlocked: results.filter((result) => result.status === 'budget_blocked').length,
  };
}

function publicModel(model: EvaluationRunConfig['candidateModel']): Record<string, unknown> {
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    api: model.api,
    apiKeyEnv: model.apiKeyEnv,
    ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
  };
}

async function readProductVersion(repositoryRoot: string): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('version' in raw)
    || typeof raw.version !== 'string' || raw.version.length === 0) {
    throw new Error('Product package version is unavailable.');
  }
  return raw.version;
}
