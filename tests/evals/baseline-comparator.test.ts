/* Verifies Baseline comparison only occurs under the complete comparability key. */
import { describe, expect, it } from 'vitest';
import { approveBaseline, compareWithBaseline } from '../../evals/agent/reporting/baseline-comparator';
import { EvaluationRunResultSchema } from '../../evals/agent/runtime/evaluation-result';

describe('Evaluation Baseline', () => {
  it('reports a newly introduced hard-gate failure for a matching key', () => {
    const base = result('passed', 'pass');
    const baseline = approveBaseline({ baselineId: 'base', result: base, approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: 'developer', fixtureVersions: { case: 1 } });
    const comparison = compareWithBaseline({ result: result('failed', 'fail'), baseline, fixtureVersions: { case: 1 } });
    expect(comparison.status).toBe('comparable');
    expect(comparison.regressions[0]).toContain('hard-gate');
  });

  it('does not compare a changed Fixture version', () => {
    const base = result('passed', 'pass');
    const baseline = approveBaseline({ baselineId: 'base', result: base, approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: 'developer', fixtureVersions: { case: 1 } });
    expect(compareWithBaseline({ result: base, baseline, fixtureVersions: { case: 2 } }).status).toBe('not_comparable');
  });
});

function result(status: 'passed' | 'failed', judgement: 'pass' | 'fail') {
  return EvaluationRunResultSchema.parse({
    runId: 'run:1', profile: 'controlled', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', candidateModel: 'candidate/model', graderModelAndRuleVersion: 'grader/model@v1',
    environment: { productVersion: '0.2.0', nodeVersion: 'v24', platform: 'win32', architecture: 'x64', suiteIds: ['core'], repetitions: 1, concurrency: 1 },
    caseResults: [{ caseRunId: 'case:r1', caseId: 'case', revision: 1, capability: 'conversation', profile: 'controlled', status, startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', grades: [{ grader: 'deterministic', dimension: 'business_completion_present', judgement, rationale: 'Result', evidenceRefs: [], ruleVersion: 'v1', gradedAt: '2026-01-01T00:01:00.000Z' }], measurements: { durationMs: 60000 } }],
    totals: { passed: status === 'passed' ? 1 : 0, failed: status === 'failed' ? 1 : 0, notGradable: 0, evaluationErrors: 0, budgetBlocked: 0 },
  });
}
