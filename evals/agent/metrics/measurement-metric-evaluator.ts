/* Compares declared efficiency and production Measurements with Task thresholds. */
import {
  TaskMetricResultSchema,
  type TaskMetricResult,
} from '../contracts/evaluation-result';
import type { MeasurementMetric } from '../contracts/evaluation-metric';
import type { EvidenceBundle } from '../runtime/evidence-collector';

export function evaluateMeasurementMetrics(input: {
  readonly metrics: readonly MeasurementMetric[];
  readonly evidence: EvidenceBundle;
  readonly now: string;
}): TaskMetricResult[] {
  return input.metrics.map((metric) => {
    const actual = input.evidence.measurements[metric.measurement];
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
      evidenceRefs: [`${input.evidence.evidenceId}#measurements.${metric.measurement}`],
      ruleVersion: 'evaluation-measurements-v1',
      evaluatedAt: input.now,
    });
  });
}
