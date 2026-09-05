/*
 * Grades sealed runs, binds reviewer evidence, and writes separate offline reports.
 */
import { getMetricDefinition } from '../metrics/metric-catalog';
import { automaticMetric } from './automatic-metrics';
import { GradingProfileSchema, ReviewSchema, ScoreReportSchema,
  type GradedCase, type GradingProfile, type MetricResult, type ScoreReport } from './grading-contract';
import { digest, loadRunEvidence, requireSeparateOutput, writeReportFiles, type CaseEvidence } from './record-evidence';

/** Scores an immutable Run without opening a Product Runtime or calling a model. */
export async function scoreEvaluationRun(input: {
  readonly runDirectory: string; readonly outputDirectory: string; readonly profile: unknown; readonly review?: unknown;
}): Promise<ScoreReport> {
  const output = await requireSeparateOutput(input.outputDirectory, [input.runDirectory]);
  const profile = GradingProfileSchema.parse(input.profile);
  const profileDigest = digest(profile);
  const { run, cases: evidence, runDigest } = await loadRunEvidence(input.runDirectory);
  const cases: GradedCase[] = evidence.map((entry) => {
    const metrics = profile.metrics.map((policy): MetricResult => {
      const definition = getMetricDefinition(policy.metricId);
      if (definition?.scope !== 'common' && definition?.scope !== entry.snapshot.case.type) {
        return { metricId: policy.metricId, status: 'not_applicable', reason: 'Metric scope does not apply to this Case.' };
      }
      return policy.method === 'human'
        ? { metricId: policy.metricId, status: 'needs_review', reason: policy.rubric ?? 'Human review required.' }
        : automaticMetric(policy, entry);
    });
    return { caseIdentity: entry.snapshot.identity, caseDigest: entry.snapshot.digest, evidenceDigest: entry.evidenceDigest,
      environmentKind: entry.snapshot.environmentKind, caseType: entry.snapshot.case.type,
      recordStatus: entry.traceError ? 'infrastructure_failed' : entry.result.recordStatus, terminalState: entry.result.terminalState,
      status: unexpectedBusinessFailure(entry) ? 'failed' : 'incomplete', metrics };
  });
  if (input.review !== undefined) {
    const review = ReviewSchema.parse(input.review);
    if (review.runId !== run.runId || review.profileDigest !== profileDigest) throw new Error('Review Run/Profile binding does not match.');
    for (const judgment of review.entries) {
      const target = cases.find((item) => item.caseIdentity === judgment.caseIdentity);
      if (!target || target.caseDigest !== judgment.caseDigest || target.evidenceDigest !== judgment.evidenceDigest) {
        throw new Error('Review evidence binding does not match current Case evidence.');
      }
      const policy = profile.metrics.find((item) => item.metricId === judgment.metricId);
      const index = target.metrics.findIndex((item) => item.metricId === judgment.metricId);
      if (policy?.method !== 'human' || index < 0 || target.metrics[index]?.status !== 'needs_review') throw new Error('Review cannot override an automatic or inapplicable metric.');
      if (judgment.decision === 'pending') continue;
      target.metrics[index] = judgment.decision === 'scored'
        ? { metricId: judgment.metricId, status: 'scored', numerator: judgment.numerator, denominator: judgment.denominator,
          value: judgment.numerator / judgment.denominator, reason: judgment.reason, reviewer: judgment.reviewer }
        : { metricId: judgment.metricId, status: 'not_applicable', reason: judgment.reason, reviewer: judgment.reviewer };
    }
  }
  for (const item of cases) item.status = caseStatus(item, profile);
  const status = cases.some((item) => item.status === 'failed') ? 'failed'
    : cases.some((item) => item.status === 'incomplete') ? 'incomplete' : 'passed';
  const report = ScoreReportSchema.parse({ schemaVersion: 1, createdAt: new Date().toISOString(),
    runId: run.runId, runDigest, candidateModel: run.candidateModel, profile, profileDigest, status, cases });
  const reviewTemplate = { schemaVersion: 1, runId: run.runId, profileDigest, entries: cases.flatMap((item) => item.metrics
    .filter((metric) => metric.status === 'needs_review').map((metric) => ({
      caseIdentity: item.caseIdentity, caseDigest: item.caseDigest, evidenceDigest: item.evidenceDigest,
      metricId: metric.metricId, decision: 'pending',
    }))) };
  await writeReportFiles(output, { 'review-template.json': reviewTemplate, 'report.md': renderScoreReport(report), 'score.json': report });
  return report;
}

/** Separates explicit threshold failures from incomplete evidence and pending evaluation. */
function caseStatus(item: GradedCase, profile: GradingProfile): GradedCase['status'] {
  if (item.status === 'failed') return 'failed';
  const failed = item.metrics.some((metric) => {
    const policy = profile.metrics.find((entry) => entry.metricId === metric.metricId);
    return metric.status === 'scored' && policy?.threshold !== undefined
      && (policy.direction === 'higher' ? metric.value < policy.threshold : metric.value > policy.threshold);
  });
  if (failed) return 'failed';
  if (item.recordStatus !== 'recorded' || item.terminalState !== 'settled'
    || item.metrics.some((metric) => metric.status === 'unavailable' || metric.status === 'needs_review')
    || !item.metrics.some((metric) => metric.status === 'scored')) return 'incomplete';
  return 'passed';
}

/** Preserves explicit business failures; author-declared failure/cancellation scenarios may still be evaluated. */
function unexpectedBusinessFailure(evidence: CaseEvidence): boolean {
  const evaluationCase = evidence.snapshot.case;
  const allowed: readonly string[] = evaluationCase.type === 'conversation' || evaluationCase.type === 'recommendation'
    ? evaluationCase.expected?.allowedOutcomes ?? [] : [];
  const inspect = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(inspect);
    if (!value || typeof value !== 'object') return false;
    if ('status' in value && (value.status === 'failed' || value.status === 'cancelled') && !allowed.includes(value.status)) return true;
    return Object.values(value).some(inspect);
  };
  return inspect(evidence.result.productResult);
}

/** Renders per-Case facts and coverage without inventing an overall weighted quality score. */
function renderScoreReport(report: ScoreReport): string {
  const lines = ['# Evaluation score', '', 'Run: ' + report.runId, '', 'Status: **' + report.status + '**', '',
    'This conclusion covers only the selected metrics and cases. Pending reviews and missing evidence are not passes.', '',
    '| Metric | Scored | Unavailable | Needs review | Not applicable |', '| --- | ---: | ---: | ---: | ---: |'];
  for (const policy of report.profile.metrics) {
    const values = report.cases.flatMap((item) => item.metrics.filter((metric) => metric.metricId === policy.metricId));
    const counts = ['scored', 'unavailable', 'needs_review', 'not_applicable'].map((status) => values.filter((metric) => metric.status === status).length);
    lines.push('| ' + policy.metricId + ' | ' + counts.join(' | ') + ' |');
  }
  for (const item of report.cases) {
    lines.push('', '## ' + item.caseIdentity, '', 'Status: ' + item.status, '', 'Evidence: ' + item.evidenceDigest, '');
    for (const metric of item.metrics) {
      lines.push('- ' + metric.metricId + ': ' + (metric.status === 'scored' ? metric.value : metric.status) + ' — ' + metric.reason.replaceAll('\n', ' '));
    }
  }
  lines.push('', '## Human rubrics', '');
  for (const policy of report.profile.metrics.filter((item) => item.method === 'human')) lines.push('- ' + policy.metricId + ': ' + policy.rubric);
  return lines.join('\n') + '\n';
}
