/* Verifies the report is a projection of the validated machine result. */
import { describe, expect, it } from 'vitest';
import { EvaluationRunResultSchema } from '../../evals/agent/runtime/evaluation-result';
import { renderEvaluationReport } from '../../evals/agent/reporting/report-writer';

describe('Evaluation report writer', () => {
  it('shows environment identity, Case status, Evidence, and measurements', () => {
    const result = EvaluationRunResultSchema.parse({
      runId: 'run:1', profile: 'controlled', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z',
      candidateModel: 'candidate/model', graderModelAndRuleVersion: 'grader/model@v1',
      environment: { productVersion: '0.2.0', nodeVersion: 'v24', platform: 'win32', architecture: 'x64', suiteIds: ['core'], repetitions: 1, concurrency: 1 },
      caseResults: [{ caseRunId: 'case:r1', caseId: 'case', revision: 1, capability: 'conversation', profile: 'controlled', status: 'passed', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', evidencePath: 'evidence/case.json', grades: [], measurements: { durationMs: 60000 } }],
      totals: { passed: 1, failed: 0, notGradable: 0, evaluationErrors: 0, budgetBlocked: 0 },
    });
    const report = renderEvaluationReport(result, {
      status: 'comparable', regressions: ['case: hard gate failed.'], trends: [],
    });
    expect(report).toContain('candidate/model');
    expect(report).toContain('case (passed)');
    expect(report).toContain('evidence/case.json');
    expect(report).toContain('Baseline Comparison');
    expect(report).toContain('hard gate failed');
  });
});
