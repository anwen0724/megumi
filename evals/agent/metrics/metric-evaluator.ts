/* Evaluates every Task-declared Metric and returns results in author-declared order. */
import type {
  MeasurementMetric,
  ModelMetric,
  RuleMetric,
} from '../contracts/evaluation-metric';
import type { TaskMetricResult } from '../contracts/evaluation-result';
import type { EvaluationTask } from '../contracts/evaluation-task';
import type { EvidenceBundle } from '../runtime/evidence-collector';
import { evaluateMeasurementMetrics } from './measurement-metric-evaluator';
import type { ModelMetricEvaluator } from './model-metric-evaluator';
import { evaluateRuleMetrics } from './rule-metric-evaluator';

export async function evaluateTaskMetrics(input: {
  readonly task: EvaluationTask;
  readonly evidence: EvidenceBundle;
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
}> {
  const rules = input.task.metrics.filter((metric): metric is RuleMetric => metric.evaluator === 'rule');
  const models = input.task.metrics.filter((metric): metric is ModelMetric => metric.evaluator === 'model');
  const measurements = input.task.metrics.filter((metric): metric is MeasurementMetric => (
    metric.evaluator === 'measurement'
  ));
  const modelOutcome = await input.modelEvaluator.evaluate({
    task: input.task,
    metrics: models,
    evidence: input.evidence,
    now: input.now,
  });
  const unordered = [
    ...evaluateRuleMetrics({ metrics: rules, evidence: input.evidence, now: input.now }),
    ...modelOutcome.results,
    ...evaluateMeasurementMetrics({ metrics: measurements, evidence: input.evidence, now: input.now }),
  ];
  const byMetricId = new Map(unordered.map((result) => [result.metricId, result]));
  return {
    results: input.task.metrics.map((metric) => {
      const result = byMetricId.get(metric.metricId);
      if (!result) throw new Error(`Metric was not evaluated: ${metric.metricId}.`);
      return result;
    }),
    modelUsage: modelOutcome.usage,
  };
}
