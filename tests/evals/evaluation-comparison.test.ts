/*
 * Verifies paired baseline comparisons cannot hide regressions or coverage changes.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareScoreReports } from '../../evals/agent/grading/compare-scores';
import { digest } from '../../evals/agent/grading/record-evidence';
import { ScoreReportSchema } from '../../evals/agent/grading/grading-contract';

describe('evaluation baseline comparison', () => {
  it('reports quality regression even when model cost decreases', () => {
    const baseline = report(1, 100);
    const candidate = report(0.5, 50);
    const comparison = compareScoreReports({ baseline, candidate });
    expect(comparison.status).toBe('regressed');
    expect(comparison.cases[0]?.metrics.map((metric) => metric.change)).toEqual(['regressed', 'improved']);
  });
  it('cannot pass by dropping a Case or changing its input', () => {
    const baseline = report(1, 100);
    const candidate = report(1, 90);
    baseline.cases.push({ ...baseline.cases[0], caseIdentity: 'controlled/extra' });
    expect(compareScoreReports({ baseline, candidate }).status).toBe('inconclusive');
    baseline.cases.pop();
    candidate.cases[0].caseDigest = '1'.repeat(64);
    expect(compareScoreReports({ baseline, candidate }).status).toBe('inconclusive');
  });
  it('requires the same rubric, complete evidence and a controlled environment', () => {
    const baseline = report(1, 100);
    const candidate = report(1, 90);
    candidate.profile.revision++;
    candidate.profileDigest = digest(candidate.profile);
    expect(() => compareScoreReports({ baseline, candidate })).toThrow(/profile/i);
    const incomplete = report(1, 90);
    incomplete.status = 'incomplete';
    expect(compareScoreReports({ baseline, candidate: incomplete }).status).toBe('inconclusive');
    baseline.cases[0].environmentKind = 'live';
    const live = report(1, 90);
    live.cases[0].environmentKind = 'live';
    expect(compareScoreReports({ baseline, candidate: live }).status).toBe('inconclusive');
  });
  it('compares all identical Cases and preserves signed metric deltas', () => {
    const result = compareScoreReports({ baseline: report(1, 100), candidate: report(1, 90) });
    expect(result.status).toBe('no_observed_regression');
    expect(result.cases[0]?.metrics[1]).toMatchObject({ delta: -10, change: 'improved' });
    expect(result.metrics[1]).toMatchObject({ pairedCount: 1, baselineMean: 100, candidateMean: 90 });
  });
  it('reports newly failed business execution as regression even if all measured costs improve', () => {
    const baseline = report(1, 100);
    const candidate = report(1, 20);
    candidate.status = 'failed';
    candidate.cases[0].status = 'failed';
    expect(compareScoreReports({ baseline, candidate }).status).toBe('regressed');
  });
});

function report(quality: number, tokens: number) {
  const profile = { schemaVersion: 1, profileId: 'test', revision: 1, metrics: [
    { metricId: 'recommendation.relevance', method: 'human', direction: 'higher', rubric: 'Relevant items / published items.' },
    { metricId: 'efficiency.input_tokens', method: 'measurement', direction: 'lower' },
  ] };
  return ScoreReportSchema.parse({ schemaVersion: 1, createdAt: '2026-09-06T00:00:00.000Z', runId: 'test', runDigest: '0'.repeat(64),
    candidateModel: { source: 'explicit', providerId: 'test', modelId: 'test', api: 'test', baseUrl: 'https://example.test', contextWindowTokens: 1000, maxOutputTokens: 100 },
    profile, profileDigest: digest(profile), status: 'passed', cases: [{ caseIdentity: 'controlled/test', caseDigest: '0'.repeat(64), evidenceDigest: '0'.repeat(64),
      environmentKind: 'controlled', caseType: 'recommendation', recordStatus: 'recorded', terminalState: 'settled', status: 'passed', metrics: [
        { metricId: 'recommendation.relevance', status: 'scored', value: quality, reason: 'Reviewed.' },
        { metricId: 'efficiency.input_tokens', status: 'scored', value: tokens, reason: 'Measured.' },
      ] }] });
}
