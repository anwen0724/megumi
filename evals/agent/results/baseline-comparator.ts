/* Defines explicit Baseline approval and comparable Task regression checks. */
import { z } from 'zod';
import type { EvaluationRunResult, TaskEvaluationResult } from '../contracts/evaluation-result';

const BaselineTaskSchema = z.object({
  taskId: z.string().min(1),
  revision: z.number().int().positive(),
  profile: z.enum(['controlled', 'live']),
  candidateModel: z.string().min(1),
  graderModelAndMetricVersion: z.string().min(1),
  sampleCount: z.number().int().positive(),
  passRate: z.number().min(0).max(1),
  requiredMetricPassRates: z.record(z.string(), z.number().min(0).max(1)),
  modelMetricScoreAverages: z.record(z.string(), z.number().min(0).max(4)),
  measurementAverages: z.record(z.string(), z.number().nonnegative()),
}).strict();

export const EvaluationBaselineSchema = z.object({
  baselineId: z.string().min(1),
  approvedAt: z.string().datetime({ offset: true }),
  approvedBy: z.string().min(1),
  pinnedRunId: z.string().min(1),
  tasks: z.array(BaselineTaskSchema),
  passRateTolerance: z.number().min(0).max(1).default(0),
}).strict();
export type EvaluationBaseline = z.infer<typeof EvaluationBaselineSchema>;

export interface BaselineComparison {
  readonly status: 'comparable' | 'not_comparable';
  readonly regressions: readonly string[];
  readonly trends: readonly string[];
}

export function compareWithBaseline(input: {
  readonly result: EvaluationRunResult;
  readonly baseline: EvaluationBaseline;
}): BaselineComparison {
  assertValidRun(input.result);
  const regressions: string[] = [];
  const trends: string[] = [];
  let comparable = 0;
  for (const group of groupResults(input.result.taskResults)) {
    const sample = group[0];
    if (!sample) continue;
    const baseline = input.baseline.tasks.find((entry) => (
      entry.taskId === sample.taskId
      && entry.revision === sample.revision
      && entry.profile === sample.profile
      && entry.candidateModel === input.result.candidateModel
      && entry.graderModelAndMetricVersion === input.result.graderModelAndMetricVersion
    ));
    if (!baseline) continue;
    comparable += 1;
    const observations: string[] = [];
    const currentPassRate = passRate(group);
    if (currentPassRate < baseline.passRate - input.baseline.passRateTolerance) {
      observations.push(`${sample.taskId}: pass rate ${currentPassRate.toFixed(3)} < ${baseline.passRate.toFixed(3)}.`);
    }
    for (const [metricId, baselineRate] of Object.entries(baseline.requiredMetricPassRates)) {
      const currentRate = metricPassRate(group, metricId);
      if (currentRate < baselineRate - input.baseline.passRateTolerance) {
        observations.push(`${sample.taskId}/${metricId}: pass rate ${currentRate.toFixed(3)} < ${baselineRate.toFixed(3)}.`);
      }
    }
    if (sample.profile === 'live') trends.push(...observations);
    else regressions.push(...observations);
  }
  return { status: comparable > 0 ? 'comparable' : 'not_comparable', regressions, trends };
}

export function approveBaseline(input: {
  readonly baselineId: string;
  readonly result: EvaluationRunResult;
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly passRateTolerance?: number;
}): EvaluationBaseline {
  assertValidRun(input.result);
  return EvaluationBaselineSchema.parse({
    baselineId: input.baselineId,
    approvedAt: input.approvedAt,
    approvedBy: input.approvedBy,
    pinnedRunId: input.result.runId,
    tasks: groupResults(input.result.taskResults).map((group) => {
      const first = group[0];
      if (!first) throw new Error('Cannot approve an empty Baseline group.');
      const requiredMetricIds = first.metricResults
        .filter((metric) => metric.required && metric.evaluator !== 'human')
        .map((metric) => metric.metricId);
      const modelMetricIds = first.metricResults.filter((metric) => metric.evaluator === 'model').map((metric) => metric.metricId);
      return {
        taskId: first.taskId,
        revision: first.revision,
        profile: first.profile,
        candidateModel: input.result.candidateModel,
        graderModelAndMetricVersion: input.result.graderModelAndMetricVersion,
        sampleCount: group.length,
        passRate: passRate(group),
        requiredMetricPassRates: Object.fromEntries(requiredMetricIds.map((metricId) => [
          metricId,
          metricPassRate(group, metricId),
        ])),
        modelMetricScoreAverages: Object.fromEntries(modelMetricIds.map((metricId) => [
          metricId,
          averageMetricScore(group, metricId),
        ])),
        measurementAverages: averageMeasurements(group),
      };
    }),
    passRateTolerance: input.passRateTolerance ?? 0,
  });
}

function groupResults(results: readonly TaskEvaluationResult[]): TaskEvaluationResult[][] {
  const groups = new Map<string, TaskEvaluationResult[]>();
  for (const result of results) {
    const key = `${result.taskId}\u0000${result.revision}\u0000${result.profile}`;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function passRate(group: readonly TaskEvaluationResult[]): number {
  return group.filter((entry) => entry.judgement === 'passed').length / group.length;
}

function assertValidRun(result: EvaluationRunResult): void {
  if (result.infrastructureStatus !== 'valid') {
    throw new Error('Invalid Evaluation Runs cannot be compared with or approved as a Baseline.');
  }
}

function metricPassRate(group: readonly TaskEvaluationResult[], metricId: string): number {
  const results = group.flatMap((entry) => entry.metricResults.filter((metric) => (
    metric.metricId === metricId && metric.evaluator !== 'human'
  )));
  return results.length === 0 ? 0 : results.filter((metric) => metric.judgement === 'pass').length / results.length;
}

function averageMetricScore(group: readonly TaskEvaluationResult[], metricId: string): number {
  const scores = group.flatMap((entry) => entry.metricResults.flatMap((metric) => (
    metric.metricId === metricId && metric.score !== undefined ? [metric.score] : []
  )));
  return scores.length === 0 ? 0 : scores.reduce((total, score) => total + score, 0) / scores.length;
}

function averageMeasurements(group: readonly TaskEvaluationResult[]): Record<string, number> {
  const keys = Object.keys(group[0]?.measurements ?? {});
  return Object.fromEntries(keys.map((key) => [
    key,
    group.reduce((total, entry) => total + measurementValue(entry, key), 0) / group.length,
  ]));
}

function measurementValue(result: TaskEvaluationResult, key: string): number {
  const value = Object.entries(result.measurements).find(([name]) => name === key)?.[1];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
