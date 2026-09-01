/* Defines explicit Baseline approval and comparable-group regression checks. */
import { z } from 'zod';
import type { CaseEvaluationResult, EvaluationRunResult } from '../runtime/evaluation-result';

const BaselineCaseSchema = z.object({
  caseId: z.string().min(1),
  revision: z.number().int().positive(),
  profile: z.enum(['controlled', 'live']),
  fixtureVersion: z.number().int().positive(),
  candidateModel: z.string().min(1),
  graderModelAndRuleVersion: z.string().min(1),
  sampleCount: z.number().int().positive(),
  passRate: z.number().min(0).max(1),
  hardGateFailureCount: z.number().int().nonnegative(),
  requiredDimensionScores: z.record(z.string(), z.array(z.number().min(0).max(4))),
  requiredDimensionPassRates: z.record(z.string(), z.number().min(0).max(1)),
  measurementAverages: z.record(z.string(), z.number().nonnegative()),
  measurementLimits: z.record(z.string(), z.number().nonnegative()),
}).strict();

export const EvaluationBaselineSchema = z.object({
  baselineId: z.string().min(1),
  approvedAt: z.string().datetime({ offset: true }),
  approvedBy: z.string().min(1),
  pinnedRunId: z.string().min(1),
  cases: z.array(BaselineCaseSchema),
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
  readonly fixtureVersions: Readonly<Record<string, number>>;
}): BaselineComparison {
  const regressions: string[] = [];
  const trends: string[] = [];
  let comparable = 0;
  for (const group of groupResults(input.result.caseResults)) {
    const sample = group[0];
    if (!sample) continue;
    const baseline = input.baseline.cases.find((entry) => comparableKeyMatches({
      baseline: entry,
      current: sample,
      fixtureVersion: input.fixtureVersions[sample.caseId],
      result: input.result,
    }));
    if (!baseline) continue;
    comparable += 1;
    const currentPassRate = passRate(group);
    const observations: string[] = [];
    if (group.filter(hasHardGateFailure).length > baseline.hardGateFailureCount) {
      observations.push(`${sample.caseId}: new hard-gate failure.`);
    }
    if (currentPassRate < baseline.passRate - input.baseline.passRateTolerance) {
      observations.push(`${sample.caseId}: pass rate ${currentPassRate.toFixed(3)} < ${baseline.passRate.toFixed(3)}.`);
    }
    for (const [dimension, baselineRate] of Object.entries(baseline.requiredDimensionPassRates)) {
      const currentRate = dimensionPassRate(group, dimension);
      if (currentRate < baselineRate - input.baseline.passRateTolerance) {
        observations.push(`${sample.caseId}/${dimension}: pass rate ${currentRate.toFixed(3)} < ${baselineRate.toFixed(3)}.`);
      }
    }
    for (const [measurement, limit] of Object.entries(baseline.measurementLimits)) {
      if (group.some((entry) => measurementValue(entry, measurement) > limit)) {
        observations.push(`${sample.caseId}/${measurement}: configured limit ${limit} exceeded.`);
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
  readonly fixtureVersions: Readonly<Record<string, number>>;
  readonly passRateTolerance?: number;
}): EvaluationBaseline {
  const cases = groupResults(input.result.caseResults).map((group) => {
    const first = group[0];
    if (!first) throw new Error('Cannot approve an empty Baseline group.');
    const fixtureVersion = input.fixtureVersions[first.caseId];
    if (fixtureVersion === undefined) {
      throw new Error(`Cannot approve Baseline without Fixture version: ${first.caseId}.`);
    }
    return {
      caseId: first.caseId,
      revision: first.revision,
      profile: first.profile,
      fixtureVersion,
      candidateModel: input.result.candidateModel,
      graderModelAndRuleVersion: input.result.graderModelAndRuleVersion,
      sampleCount: group.length,
      passRate: passRate(group),
      hardGateFailureCount: group.filter(hasHardGateFailure).length,
      requiredDimensionScores: Object.fromEntries(first.requiredDimensions.map((dimension) => [
        dimension,
        dimensionScores(group, dimension),
      ])),
      requiredDimensionPassRates: Object.fromEntries(first.requiredDimensions.map((dimension) => [
        dimension,
        dimensionPassRate(group, dimension),
      ])),
      measurementAverages: averageMeasurements(group),
      measurementLimits: first.measurementLimits,
    };
  });
  return EvaluationBaselineSchema.parse({
    baselineId: input.baselineId,
    approvedAt: input.approvedAt,
    approvedBy: input.approvedBy,
    pinnedRunId: input.result.runId,
    cases,
    passRateTolerance: input.passRateTolerance ?? 0,
  });
}

function groupResults(results: readonly CaseEvaluationResult[]): CaseEvaluationResult[][] {
  const groups = new Map<string, CaseEvaluationResult[]>();
  for (const result of results) {
    const key = `${result.caseId}\u0000${result.revision}\u0000${result.profile}`;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function comparableKeyMatches(input: {
  readonly baseline: z.infer<typeof BaselineCaseSchema>;
  readonly current: CaseEvaluationResult;
  readonly fixtureVersion: number | undefined;
  readonly result: EvaluationRunResult;
}): boolean {
  return input.baseline.caseId === input.current.caseId
    && input.baseline.revision === input.current.revision
    && input.baseline.profile === input.current.profile
    && input.baseline.fixtureVersion === input.fixtureVersion
    && input.baseline.candidateModel === input.result.candidateModel
    && input.baseline.graderModelAndRuleVersion === input.result.graderModelAndRuleVersion;
}

function passRate(group: readonly CaseEvaluationResult[]): number {
  return group.filter((entry) => entry.status === 'passed').length / group.length;
}

function hasHardGateFailure(result: CaseEvaluationResult): boolean {
  return result.grades.some((grade) => grade.grader === 'deterministic' && grade.judgement === 'fail');
}

function dimensionScores(group: readonly CaseEvaluationResult[], dimension: string): number[] {
  return group.flatMap((entry) => entry.grades
    .flatMap((grade) => (
      grade.grader === 'model' && grade.dimension === dimension && grade.score !== undefined
        ? [grade.score]
        : []
    )));
}

function dimensionPassRate(group: readonly CaseEvaluationResult[], dimension: string): number {
  const scores = dimensionScores(group, dimension);
  return scores.length === 0 ? 0 : scores.filter((score) => score >= 3).length / scores.length;
}

function averageMeasurements(group: readonly CaseEvaluationResult[]): Record<string, number> {
  const keys = Object.keys(group[0]?.measurements ?? {});
  return Object.fromEntries(keys.map((key) => [
    key,
    group.reduce((total, entry) => total + measurementValue(entry, key), 0) / group.length,
  ]));
}

function measurementValue(result: CaseEvaluationResult, key: string): number {
  const value = Object.entries(result.measurements).find(([name]) => name === key)?.[1];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
