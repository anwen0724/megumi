/* Compares declared efficiency and production Measurements with Task thresholds. */
import {
  TaskMetricResultSchema,
  type TaskMetricResult,
} from '../contracts/evaluation-result';
import type { MeasurementMetric } from '../contracts/evaluation-metric';
import type { TaskObservation } from '../execution/observe-task';

export function gradeMeasurementMetrics(input: {
  readonly metrics: readonly MeasurementMetric[];
  readonly observation: TaskObservation;
  readonly now: string;
}): TaskMetricResult[] {
  return input.metrics.map((metric) => {
    const actual = input.observation.measurements[metric.measurement];
    const passed = metric.operator === 'max' ? actual <= metric.threshold : actual >= metric.threshold;
    return TaskMetricResultSchema.parse({
      metricId: metric.metricId,
      title: metric.title,
      evaluator: 'measurement',
      required: metric.required,
      judgement: passed ? 'pass' : 'fail',
      actual,
      threshold: metric.threshold,
      operator: metric.operator,
      rationale: `${metric.measurement} 实际值 ${actual}，要求${metric.operator === 'max' ? '不超过' : '不少于'} ${metric.threshold}。`,
      evidenceRefs: [`${input.observation.observationId}#measurements.${metric.measurement}`],
      ruleVersion: 'evaluation-measurements-v1',
      evaluatedAt: input.now,
    });
  });
}
