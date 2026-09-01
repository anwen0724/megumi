/*
 * Drives Evaluation Tasks through the real ProductRuntime and keeps infrastructure failure separate.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ResolvedEvaluationModel,
  ResolvedEvaluationModels,
} from '../adapters/evaluation-model-source';
import type { EvaluationRunConfig } from '../contracts/evaluation-run-config';
import {
  EvaluationRunResultSchema,
  TaskEvaluationResultSchema,
  type EvaluationRunResult,
  type TaskEvaluationResult,
  type TaskMetricResult,
} from '../contracts/evaluation-result';
import type { EvaluationTask } from '../contracts/evaluation-task';
import { gradeTask } from '../grading/grade-task';
import type { ModelMetricEvaluator } from '../grading/model-grader';
import { createRunStorage, type EvaluationRunStorage } from '../results/run-storage';
import { createEvaluationHost, type EvaluationHost } from './evaluation-host';
import { executeTask } from './execute-task';
import { observeTask } from './observe-task';
import { createRunBudget } from './run-budget';
import type { EvaluationTaskCatalog } from './task-loader';

export interface EvaluationRunnerDependencies {
  readonly modelMetricEvaluator: ModelMetricEvaluator;
  readonly createHost?: typeof createEvaluationHost;
  readonly now?: () => Date;
  readonly createRunId?: () => string;
}

/** Executes the selected Tasks and persists one valid quality result or invalid diagnostic result. */
export async function runEvaluation(input: {
  readonly repositoryRoot: string;
  readonly catalog: EvaluationTaskCatalog;
  readonly config: EvaluationRunConfig;
  readonly models: ResolvedEvaluationModels;
  readonly dependencies: EvaluationRunnerDependencies;
}): Promise<{ readonly result: EvaluationRunResult; readonly storage: EvaluationRunStorage }> {
  const now = input.dependencies.now ?? (() => new Date());
  const runId = input.dependencies.createRunId?.() ?? `run:${crypto.randomUUID()}`;
  const startedAt = now().toISOString();
  const productVersion = await readProductVersion(input.repositoryRoot);
  const storage = await createRunStorage(input.config.runRoot, runId);
  const scheduled = scheduleTasks(input.catalog.resolveTasks(input.config), input.config.repetitions);
  await storage.writeManifest({
    runId,
    startedAt,
    profile: input.config.profile,
    taskIds: input.config.taskIds,
    suiteIds: input.config.suiteIds,
    candidateModel: publicModel(input.models.candidate),
    graderModel: publicModel(input.models.grader),
    repetitions: input.config.repetitions,
    concurrency: input.config.concurrency,
    budget: input.config.budget,
    productVersion,
  });

  const budget = createRunBudget(input.config.budget);
  const results: TaskEvaluationResult[] = new Array(scheduled.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(input.config.concurrency, scheduled.length) }, async () => {
    while (cursor < scheduled.length) {
      const index = cursor++;
      const scheduledTask = scheduled[index];
      if (!budget.canStartTask()) {
        results[index] = budgetBlockedResult(scheduledTask, input.config.profile, now().toISOString());
        continue;
      }
      results[index] = await runTask({ ...input, storage, scheduledTask, now });
      budget.record(results[index].measurements);
    }
  });
  await Promise.all(workers);

  const result = EvaluationRunResultSchema.parse({
    runId,
    profile: input.config.profile,
    infrastructureStatus: results.some((result) => result.infrastructureStatus === 'invalid')
      ? 'invalid'
      : 'valid',
    startedAt,
    endedAt: now().toISOString(),
    candidateModel: modelLabel(input.models.candidate),
    graderModelAndMetricVersion: `${modelLabel(input.models.grader)}@evaluation-model-metrics-v2`,
    environment: {
      productVersion,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      suiteIds: input.config.suiteIds,
      repetitions: input.config.repetitions,
      concurrency: input.config.concurrency,
    },
    taskResults: results,
    totals: totals(results),
  });
  await storage.writeResult(result);
  return { result, storage };
}

async function runTask(input: {
  readonly repositoryRoot: string;
  readonly config: EvaluationRunConfig;
  readonly models: ResolvedEvaluationModels;
  readonly dependencies: EvaluationRunnerDependencies;
  readonly storage: EvaluationRunStorage;
  readonly scheduledTask: ScheduledTask;
  readonly now: () => Date;
}): Promise<TaskEvaluationResult> {
  const { task, taskRunId } = input.scheduledTask;
  const startedAt = input.now().toISOString();
  const startedAtMs = Date.now();
  let host: EvaluationHost | undefined;
  try {
    host = await (input.dependencies.createHost ?? createEvaluationHost)({
      repositoryRoot: input.repositoryRoot,
      runConfig: input.config,
      task,
      taskRoot: input.storage.taskDirectory(taskRunId),
      candidateModel: input.models.candidate,
      graderModel: input.models.grader,
    });
    const execution = await executeTask({
      task,
      runtime: host.runtime,
      initialStateIds: host.initialStateIds,
      candidateModel: {
        providerId: input.models.candidate.config.providerId,
        modelId: input.models.candidate.config.modelId,
      },
      now: () => task.initialState.clock,
    });
    const observation = await observeTask({
      observationId: `observation:${taskRunId}`,
      task,
      runtime: host.runtime,
      execution,
      environment: host.environment,
      workspacePath: host.paths.workspace,
      startedAtMs,
      collectedAt: input.now().toISOString(),
    });
    const observationPath = await input.storage.writeObservation(taskRunId, observation);
    const graded = await gradeTask({
      task,
      observation,
      modelEvaluator: input.dependencies.modelMetricEvaluator,
      now: input.now().toISOString(),
    });
    const measurements = {
      ...observation.measurements,
      graderModelCalls: graded.modelUsage.modelCalls,
      graderInputTokens: graded.modelUsage.inputTokens,
      graderOutputTokens: graded.modelUsage.outputTokens,
      graderEstimatedCostUsd: graded.modelUsage.estimatedCostUsd,
    };
    return TaskEvaluationResultSchema.parse({
      taskRunId,
      taskId: task.taskId,
      revision: task.revision,
      operation: task.input.type,
      difficulty: task.difficulty,
      profile: input.config.profile,
      executionOutcome: execution.outcome,
      judgement: graded.infrastructureError ? 'not_evaluated' : deriveJudgement(graded.results),
      infrastructureStatus: graded.infrastructureError ? 'invalid' : 'valid',
      startedAt,
      endedAt: input.now().toISOString(),
      observationPath,
      metricResults: graded.results,
      measurements,
      observationIssues: observation.issues,
      ...(graded.infrastructureError ? { infrastructureError: graded.infrastructureError } : {}),
    });
  } catch (error) {
    return infrastructureFailureResult({
      taskRunId,
      task,
      profile: input.config.profile,
      startedAt,
      endedAt: input.now().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      error,
    });
  } finally {
    await host?.dispose().catch(() => undefined);
  }
}

interface ScheduledTask {
  readonly task: EvaluationTask;
  readonly taskRunId: string;
}

function scheduleTasks(tasks: readonly EvaluationTask[], repetitions: number): ScheduledTask[] {
  return Array.from({ length: repetitions }, (_, repetition) => tasks.map((task) => ({
    task,
    taskRunId: `${task.taskId}:r${repetition + 1}`,
  }))).flat();
}

function deriveJudgement(results: readonly TaskMetricResult[]): TaskEvaluationResult['judgement'] {
  const required = results.filter((result) => result.required);
  if (required.some((result) => result.judgement === 'not_gradable')) return 'not_gradable';
  if (required.some((result) => result.judgement === 'fail')) return 'failed';
  return 'passed';
}

function budgetBlockedResult(
  entry: ScheduledTask,
  profile: EvaluationRunConfig['profile'],
  at: string,
): TaskEvaluationResult {
  return TaskEvaluationResultSchema.parse({
    taskRunId: entry.taskRunId,
    taskId: entry.task.taskId,
    revision: entry.task.revision,
    operation: entry.task.input.type,
    difficulty: entry.task.difficulty,
    profile,
    executionOutcome: { status: 'not_started', reason: 'budget_blocked' },
    judgement: 'not_evaluated',
    infrastructureStatus: 'valid',
    startedAt: at,
    endedAt: at,
    metricResults: [],
    measurements: emptyMeasurements(0),
    observationIssues: [],
  });
}

function infrastructureFailureResult(input: {
  readonly taskRunId: string;
  readonly task: EvaluationTask;
  readonly profile: EvaluationRunConfig['profile'];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly error: unknown;
}): TaskEvaluationResult {
  return TaskEvaluationResultSchema.parse({
    taskRunId: input.taskRunId,
    taskId: input.task.taskId,
    revision: input.task.revision,
    operation: input.task.input.type,
    difficulty: input.task.difficulty,
    profile: input.profile,
    executionOutcome: { status: 'not_started', reason: 'infrastructure_error' },
    judgement: 'not_evaluated',
    infrastructureStatus: 'invalid',
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    metricResults: [],
    measurements: emptyMeasurements(input.durationMs),
    observationIssues: [],
    infrastructureError: {
      code: 'evaluation_infrastructure_failed',
      message: input.error instanceof Error ? input.error.message : String(input.error),
    },
  });
}

function emptyMeasurements(durationMs: number) {
  return {
    durationMs,
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    toolCalls: 0,
    sourceCalls: 0,
    retries: 0,
    candidatesProduced: 0,
    recommendationsPublished: 0,
    preferenceRevisions: 0,
    estimatedCostUsd: 0,
    graderModelCalls: 0,
    graderInputTokens: 0,
    graderOutputTokens: 0,
    graderEstimatedCostUsd: 0,
  };
}

function totals(results: readonly TaskEvaluationResult[]) {
  return {
    passed: results.filter((result) => result.judgement === 'passed').length,
    failed: results.filter((result) => result.judgement === 'failed').length,
    notGradable: results.filter((result) => result.judgement === 'not_gradable').length,
    invalid: results.filter((result) => result.infrastructureStatus === 'invalid').length,
    budgetBlocked: results.filter((result) => result.executionOutcome.status === 'not_started'
      && result.executionOutcome.reason === 'budget_blocked').length,
  };
}

function publicModel(model: ResolvedEvaluationModel): Record<string, unknown> {
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

function modelLabel(model: ResolvedEvaluationModel): string {
  return `${model.config.providerId}/${model.config.modelId}`;
}

async function readProductVersion(repositoryRoot: string): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('version' in raw)
    || typeof raw.version !== 'string' || raw.version.length === 0) {
    throw new Error('Product package version is unavailable.');
  }
  return raw.version;
}
