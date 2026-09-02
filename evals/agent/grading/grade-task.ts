/* Evaluates every Task-declared Metric and returns results in author-declared order. */
import type {
  MeasurementMetric,
  ModelMetric,
  RuleMetric,
} from '../contracts/evaluation-metric';
import type { TaskMetricResult } from '../contracts/evaluation-result';
import type { EvaluationTask } from '../contracts/evaluation-task';
import type { TaskObservation } from '../execution/observe-task';
import { gradeMeasurementMetrics } from './measurement-grader';
import type { ModelMetricEvaluator } from './model-grader';
import { gradeRuleMetrics } from './rule-grader';

export async function gradeTask(input: {
  readonly task: EvaluationTask;
  readonly observation: TaskObservation;
  readonly modelEvaluator: ModelMetricEvaluator;
  readonly now: string;
}): Promise<{
  readonly results: readonly TaskMetricResult[];
  readonly modelUsage: {
    readonly modelCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostUsd: number;
  };
  readonly infrastructureError?: {
    readonly code: 'model_grader_failed';
    readonly message: string;
  };
}> {
  const rules = input.task.metrics.filter((metric): metric is RuleMetric => metric.evaluator === 'rule');
  const models = input.task.metrics.filter((metric): metric is ModelMetric => metric.evaluator === 'model');
  const measurements = input.task.metrics.filter((metric): metric is MeasurementMetric => (
    metric.evaluator === 'measurement'
  ));
  const modelOutcome = await evaluateModelMetrics(input, models);
  const unordered = [
    ...gradeRuleMetrics({ metrics: rules, observation: input.observation, now: input.now }),
    ...modelOutcome.results,
    ...gradeMeasurementMetrics({ metrics: measurements, observation: input.observation, now: input.now }),
  ];
  const byMetricId = new Map(unordered.map((result) => [result.metricId, result]));
  return {
    results: input.task.metrics.map((metric) => {
      const result = byMetricId.get(metric.metricId);
      if (!result) throw new Error(`Metric was not evaluated: ${metric.metricId}.`);
      return result;
    }),
    modelUsage: modelOutcome.usage,
    ...(modelOutcome.infrastructureError
      ? { infrastructureError: modelOutcome.infrastructureError }
      : {}),
  };
}

async function evaluateModelMetrics(
  input: Parameters<typeof gradeTask>[0],
  metrics: readonly ModelMetric[],
): Promise<{
  readonly results: readonly TaskMetricResult[];
  readonly usage: {
    readonly modelCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostUsd: number;
  };
  readonly infrastructureError?: {
    readonly code: 'model_grader_failed';
    readonly message: string;
  };
}> {
  if (metrics.length === 0) {
    return {
      results: [],
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
  }
  const groups = (['result', 'process'] as const)
    .map((dimension) => metrics.filter((metric) => metric.dimension === dimension))
    .filter((group) => group.length > 0);
  const outcomes = await Promise.all(groups.map((group) => evaluateModelMetricGroup(input, group)));
  const failures = outcomes.flatMap((outcome) => (
    outcome.infrastructureError ? [outcome.infrastructureError] : []
  ));
  return {
    results: outcomes.flatMap((outcome) => outcome.results),
    usage: outcomes.reduce((total, outcome) => ({
      modelCalls: total.modelCalls + outcome.usage.modelCalls,
      inputTokens: total.inputTokens + outcome.usage.inputTokens,
      outputTokens: total.outputTokens + outcome.usage.outputTokens,
      estimatedCostUsd: total.estimatedCostUsd + outcome.usage.estimatedCostUsd,
    }), { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }),
    ...(failures.length > 0
      ? {
          infrastructureError: {
            code: 'model_grader_failed' as const,
            message: failures.map(({ message }) => message).join('; '),
          },
        }
      : {}),
  };
}

async function evaluateModelMetricGroup(
  input: Parameters<typeof gradeTask>[0],
  metrics: readonly ModelMetric[],
): Promise<{
  readonly results: readonly TaskMetricResult[];
  readonly usage: {
    readonly modelCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostUsd: number;
  };
  readonly infrastructureError?: {
    readonly code: 'model_grader_failed';
    readonly message: string;
  };
}> {
  try {
    return await input.modelEvaluator.evaluate({
      task: input.task,
      metrics,
      observation: input.observation,
      now: input.now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      results: metrics.map((metric) => ({
        metricId: metric.metricId,
        title: metric.title,
        dimension: metric.dimension,
        evaluator: 'model' as const,
        required: metric.required,
        judgement: 'not_gradable' as const,
        rationale: `Model Grader unavailable: ${message}`,
        evidenceRefs: [],
        promptVersion: 'evaluation-model-metrics-v4',
        evaluatedAt: input.now,
      })),
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      infrastructureError: { code: 'model_grader_failed', message },
    };
  }
}
