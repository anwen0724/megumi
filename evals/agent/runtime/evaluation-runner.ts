/* Orchestrates Task isolation, real Product execution, Evidence, Metrics, and partial failure. */
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
import { evaluateTaskMetrics } from '../metrics/metric-evaluator';
import type { ModelMetricEvaluator } from '../metrics/model-metric-evaluator';
import { resolveTaskRunner } from '../runners/task-runner';
import { collectEvidence } from './evidence-collector';
import { createRunBudget } from './run-budget';
import { createRunStorage, type EvaluationRunStorage } from './run-storage';
import { composeEvaluationTask, type ComposedEvaluationTask } from './task-environment';
import type { EvaluationTaskCatalog } from './task-loader';

export interface EvaluationRunnerDependencies {
  readonly modelMetricEvaluator: ModelMetricEvaluator;
  readonly composeTask?: typeof composeEvaluationTask;
  readonly now?: () => Date;
  readonly createRunId?: () => string;
}

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
    startedAt,
    endedAt: now().toISOString(),
    candidateModel: modelLabel(input.models.candidate),
    graderModelAndMetricVersion: `${modelLabel(input.models.grader)}@evaluation-model-metrics-v1`,
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
  let composed: ComposedEvaluationTask | undefined;
  try {
    composed = await (input.dependencies.composeTask ?? composeEvaluationTask)({
      repositoryRoot: input.repositoryRoot,
      runConfig: input.config,
      task,
      taskRoot: input.storage.taskDirectory(taskRunId),
      candidateModel: input.models.candidate,
      graderModel: input.models.grader,
    });
    const execution = await resolveTaskRunner(task).execute({
      task,
      candidateModel: {
        providerId: input.models.candidate.config.providerId,
        modelId: input.models.candidate.config.modelId,
      },
      runtime: composed.runtime,
      scenarioIds: composed.scenarioIds,
      workspacePath: composed.paths.workspace,
      environment: composed.environment,
      now: () => task.scenario.clock,
    });
    const evidence = await collectEvidence({
      evidenceId: `evidence:${taskRunId}`,
      task,
      runtime: composed.runtime,
      execution,
      environment: composed.environment,
      startedAtMs,
      collectedAt: input.now().toISOString(),
    });
    const evidencePath = await input.storage.writeEvidence(taskRunId, evidence);
    const evaluated = await evaluateTaskMetrics({
      task,
      evidence,
      modelEvaluator: input.dependencies.modelMetricEvaluator,
      now: input.now().toISOString(),
    });
    const measurements = {
      ...evidence.measurements,
      graderModelCalls: evaluated.modelUsage.modelCalls,
      graderInputTokens: evaluated.modelUsage.inputTokens,
      graderOutputTokens: evaluated.modelUsage.outputTokens,
      graderEstimatedCostUsd: evaluated.modelUsage.estimatedCostUsd,
    };
    return TaskEvaluationResultSchema.parse({
      taskRunId,
      taskId: task.taskId,
      revision: task.revision,
      runner: task.runner,
      difficulty: task.difficulty,
      profile: input.config.profile,
      status: deriveStatus(evaluated.results),
      startedAt,
      endedAt: input.now().toISOString(),
      evidencePath,
      metricResults: evaluated.results,
      measurements,
      evidenceIssues: evidence.issues,
    });
  } catch (error) {
    return TaskEvaluationResultSchema.parse({
      taskRunId,
      taskId: task.taskId,
      revision: task.revision,
      runner: task.runner,
      difficulty: task.difficulty,
      profile: input.config.profile,
      status: 'evaluation_error',
      startedAt,
      endedAt: input.now().toISOString(),
      metricResults: [],
      measurements: emptyMeasurements(Math.max(0, Date.now() - startedAtMs)),
      error: {
        code: 'evaluation_execution_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    await composed?.dispose().catch(() => undefined);
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

function deriveStatus(results: readonly TaskMetricResult[]): TaskEvaluationResult['status'] {
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
    runner: entry.task.runner,
    difficulty: entry.task.difficulty,
    profile,
    status: 'budget_blocked',
    startedAt: at,
    endedAt: at,
    metricResults: [],
    measurements: emptyMeasurements(0),
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
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    notGradable: results.filter((result) => result.status === 'not_gradable').length,
    evaluationErrors: results.filter((result) => result.status === 'evaluation_error').length,
    budgetBlocked: results.filter((result) => result.status === 'budget_blocked').length,
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
