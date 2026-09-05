/*
 * Compares sealed scoring records only where sample identity and scoring policy are unchanged.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ScoreReportSchema, type ScoreReport, type MetricResult } from './grading-contract';
import { digest, readJson, requireSeparateOutput, writeReportFiles } from './record-evidence';

const MetricDifferenceSchema = z.object({
  metricId: z.string(), change: z.enum(['improved', 'unchanged', 'regressed', 'unavailable']),
  baseline: z.number().optional(), candidate: z.number().optional(), delta: z.number().optional(), reason: z.string(),
}).strict();
export const ComparisonReportSchema = z.object({
  schemaVersion: z.literal(1), createdAt: z.string().datetime({ offset: true }),
  status: z.enum(['regressed', 'inconclusive', 'no_observed_regression']),
  baselineRunId: z.string(), candidateRunId: z.string(), baselineDigest: z.string(), candidateDigest: z.string(),
  profileDigest: z.string(),
  models: z.object({ baseline: ScoreReportSchema.shape.candidateModel, candidate: ScoreReportSchema.shape.candidateModel }),
  cases: z.array(z.object({ caseIdentity: z.string(), issue: z.string().optional(), metrics: z.array(MetricDifferenceSchema) }).strict()),
  metrics: z.array(z.object({ metricId: z.string(), pairedCount: z.number().int().nonnegative(),
    baselineMean: z.number().optional(), candidateMean: z.number().optional() }).strict()),
}).strict();
export type ComparisonReport = z.infer<typeof ComparisonReportSchema>;

/** Compares all selected Cases, preserving failures, missing samples, and unavailable scores. */
export function compareScoreReports(input: { readonly baseline: unknown; readonly candidate: unknown }): ComparisonReport {
  const baseline = validateReport(input.baseline);
  const candidate = validateReport(input.candidate);
  if (baseline.profileDigest !== candidate.profileDigest) throw new Error('Profile differs; re-score both Runs with the same Profile.');
  const identities = new Set([...baseline.cases, ...candidate.cases].map((item) => item.caseIdentity));
  const cases: ComparisonReport['cases'] = [];
  for (const identity of identities) {
    const before = baseline.cases.find((item) => item.caseIdentity === identity);
    const after = candidate.cases.find((item) => item.caseIdentity === identity);
    const issue = !before || !after ? 'Case is missing on one side.'
      : before.caseDigest !== after.caseDigest || before.caseType !== after.caseType || before.environmentKind !== after.environmentKind
        ? 'Case input, type or environment changed; not comparable.'
        : before.status === 'passed' && after.status === 'failed' ? 'Previously passing Case now fails.'
          : before.status !== 'passed' || after.status !== 'passed' ? 'At least one Case is not fully passed.'
            : before.environmentKind === 'live' ? 'Live results are trend evidence only.' : undefined;
    const metrics: ComparisonReport['cases'][number]['metrics'] = [];
    if (before && after && before.caseDigest === after.caseDigest && before.caseType === after.caseType && before.environmentKind === after.environmentKind) {
      for (const policy of baseline.profile.metrics) {
        const left = before.metrics.find((item) => item.metricId === policy.metricId);
        const right = after.metrics.find((item) => item.metricId === policy.metricId);
        metrics.push(compareMetric(policy.metricId, policy.direction, left, right));
      }
    }
    cases.push({ caseIdentity: identity, ...(issue ? { issue } : {}), metrics });
  }
  const metrics = baseline.profile.metrics.map((policy) => {
    const pairs = cases.flatMap((item) => item.metrics.filter((metric) => metric.metricId === policy.metricId && metric.delta !== undefined));
    const result: ComparisonReport['metrics'][number] = { metricId: policy.metricId, pairedCount: pairs.length };
    if (pairs.length) {
      result.baselineMean = pairs.reduce((sum, pair) => sum + (pair.baseline ?? 0), 0) / pairs.length;
      result.candidateMean = pairs.reduce((sum, pair) => sum + (pair.candidate ?? 0), 0) / pairs.length;
    }
    return result;
  });
  const regressed = cases.some((item) => item.issue === 'Previously passing Case now fails.' || item.metrics.some((metric) => metric.change === 'regressed'));
  const gap = baseline.status !== 'passed' || candidate.status !== 'passed'
    || cases.some((item) => item.issue || item.metrics.some((metric) => metric.change === 'unavailable'))
    || !metrics.some((metric) => metric.pairedCount > 0);
  return ComparisonReportSchema.parse({ schemaVersion: 1, createdAt: new Date().toISOString(),
    status: regressed ? 'regressed' : gap ? 'inconclusive' : 'no_observed_regression',
    baselineRunId: baseline.runId, candidateRunId: candidate.runId, baselineDigest: digest(baseline), candidateDigest: digest(candidate),
    profileDigest: baseline.profileDigest, models: { baseline: baseline.candidateModel, candidate: candidate.candidateModel }, cases, metrics });
}

/** Loads persisted scores and publishes comparison artifacts without changing either input. */
export async function compareEvaluationFiles(input: {
  readonly baselineFile: string; readonly candidateFile: string; readonly outputDirectory: string;
}): Promise<ComparisonReport> {
  const output = await requireSeparateOutput(input.outputDirectory, [path.dirname(input.baselineFile), path.dirname(input.candidateFile)]);
  const report = compareScoreReports({ baseline: await readJson(input.baselineFile), candidate: await readJson(input.candidateFile) });
  report.baselineDigest = createHash('sha256').update(await readFile(input.baselineFile)).digest('hex');
  report.candidateDigest = createHash('sha256').update(await readFile(input.candidateFile)).digest('hex');
  const lines = ['# Evaluation comparison', '', 'Status: **' + report.status + '**', '',
    'Only identical Cases and scoring policies are paired. This is not proof of general or statistically significant improvement.', '',
    '| Metric | Paired cases | Baseline mean | Candidate mean |', '| --- | ---: | ---: | ---: |',
    ...report.metrics.map((item) => '| ' + item.metricId + ' | ' + item.pairedCount + ' | ' + (item.baselineMean ?? 'unavailable')
      + ' | ' + (item.candidateMean ?? 'unavailable') + ' |')];
  for (const item of report.cases) {
    lines.push('', '## ' + item.caseIdentity, '', item.issue ?? 'Identical Case input.', '');
    for (const metric of item.metrics) lines.push('- ' + metric.metricId + ': ' + metric.change + '; delta=' + (metric.delta ?? 'unavailable') + '; ' + metric.reason);
  }
  await writeReportFiles(output, { 'report.md': lines.join('\n') + '\n', 'comparison.json': report });
  return report;
}

/** Checks logical uniqueness and policy binding in addition to JSON structure. */
function validateReport(value: unknown): ScoreReport {
  const report = ScoreReportSchema.parse(value);
  if (report.profileDigest !== digest(report.profile)) throw new Error('Profile digest does not match its snapshot.');
  if (new Set(report.cases.map((item) => item.caseIdentity)).size !== report.cases.length) throw new Error('Duplicate Case in score report.');
  for (const item of report.cases) {
    if (item.metrics.length !== report.profile.metrics.length || new Set(item.metrics.map((metric) => metric.metricId)).size !== item.metrics.length
      || item.metrics.some((metric) => !report.profile.metrics.some((policy) => policy.metricId === metric.metricId))) {
      throw new Error('Score report metric coverage differs from its Profile.');
    }
  }
  return report;
}
function compareMetric(metricId: string, direction: 'higher' | 'lower', before?: MetricResult, after?: MetricResult): z.infer<typeof MetricDifferenceSchema> {
  if (before?.status === 'not_applicable' && after?.status === 'not_applicable') {
    return { metricId, change: 'unchanged', reason: 'Not applicable on both sides; excluded from paired means.' };
  }
  if (before?.status !== 'scored' || after?.status !== 'scored') {
    return { metricId, change: 'unavailable', reason: 'Both sides require scored evidence.' };
  }
  const delta = after.value - before.value;
  const improved = direction === 'higher' ? delta > 0 : delta < 0;
  return { metricId, baseline: before.value, candidate: after.value, delta,
    change: delta === 0 ? 'unchanged' : improved ? 'improved' : 'regressed', reason: direction + ' is better.' };
}
