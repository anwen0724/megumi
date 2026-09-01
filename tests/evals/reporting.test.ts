/* Protects metric-centric reports and Baseline comparison semantics. */
import { describe, expect, it } from 'vitest';
import { EvaluationRunResultSchema } from '../../evals/agent/contracts/evaluation-result';
import {
  approveBaseline,
  compareWithBaseline,
} from '../../evals/agent/reporting/baseline-comparator';
import { renderEvaluationReport } from '../../evals/agent/reporting/report-writer';

describe('Evaluation reporting', () => {
  it('reports Task Metrics and detects a comparable required-Metric regression', () => {
    const baselineResult = result('passed', 'pass');
    const baseline = approveBaseline({
      baselineId: 'baseline:1',
      result: baselineResult,
      approvedAt: '2026-01-01T00:00:02.000Z',
      approvedBy: 'developer',
    });
    const current = result('failed', 'fail');
    const comparison = compareWithBaseline({ result: current, baseline });
    expect(comparison.status).toBe('comparable');
    expect(comparison.regressions).toEqual(expect.arrayContaining([
      expect.stringContaining('conversation.task'),
    ]));
    const report = renderEvaluationReport(current, comparison);
    expect(report).toContain('## Tasks');
    expect(report).toContain('| quality | model | yes | fail | 2 |');
  });
});

function result(status: 'passed' | 'failed', judgement: 'pass' | 'fail') {
  return EvaluationRunResultSchema.parse({
    runId: 'run:1', profile: 'controlled', startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z', candidateModel: 'test/candidate',
    graderModelAndMetricVersion: 'test/grader@v1',
    environment: {
      productVersion: '0.2.0', nodeVersion: 'v22', platform: 'win32', architecture: 'x64',
      suiteIds: [], repetitions: 1, concurrency: 1,
    },
    taskResults: [{
      taskRunId: 'conversation.task:r1', taskId: 'conversation.task', revision: 1,
      runner: 'conversation', difficulty: 'simple', profile: 'controlled', status,
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z',
      metricResults: [{
        metricId: 'quality', title: 'Quality', evaluator: 'model', required: true, judgement,
        score: judgement === 'pass' ? 4 : 2, rationale: 'Result.', evidenceRefs: ['evidence:1'],
        evaluatedAt: '2026-01-01T00:00:01.000Z',
      }],
      measurements: {
        durationMs: 1_000, inputTokens: 10, outputTokens: 5, modelCalls: 1, toolCalls: 0,
        sourceCalls: 0, retries: 0, candidatesProduced: 0, recommendationsPublished: 0,
        preferenceRevisions: 0, estimatedCostUsd: 0, graderModelCalls: 1, graderInputTokens: 10,
        graderOutputTokens: 5, graderEstimatedCostUsd: 0,
      },
      evidenceIssues: [],
    }],
    totals: {
      passed: status === 'passed' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
      notGradable: 0, evaluationErrors: 0, budgetBlocked: 0,
    },
  });
}
