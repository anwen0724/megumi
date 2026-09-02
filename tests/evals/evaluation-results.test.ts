/* Verifies valid quality reports, invalid diagnostics, and Baseline eligibility. */
import { describe, expect, it } from 'vitest';
import { EvaluationRunResultSchema } from '../../evals/agent/contracts/evaluation-result';
import { approveBaseline, compareWithBaseline } from '../../evals/agent/results/baseline-comparator';
import { renderEvaluationDiagnostics, renderEvaluationReport } from '../../evals/agent/results/report-writer';

describe('Evaluation results', () => {
  it('keeps product execution facts separate and detects a result-quality regression', () => {
    const baselineResult = validResult('passed', 'pass');
    const baseline = approveBaseline({
      baselineId: 'baseline:1',
      result: baselineResult,
      approvedAt: '2026-01-01T00:00:02.000Z',
      approvedBy: 'developer',
    });
    const current = validResult('failed', 'fail');
    const comparison = compareWithBaseline({ result: current, baseline });

    expect(comparison.regressions).toEqual(expect.arrayContaining([
      expect.stringContaining('result pass rate'),
    ]));
    expect(baseline.tasks[0]).toMatchObject({
      resultPassRate: 1,
      processPassRate: 1,
      overallPassRate: 1,
    });
    expect(current.taskResults[0]).toMatchObject({
      productExecution: {
        operation: 'conversation',
        productResult: { reply: 'Done.' },
        businessIds: { executionId: 'execution:1' },
      },
      resultJudgement: 'failed',
      processJudgement: 'passed',
      overallJudgement: 'failed',
    });
    expect(renderEvaluationReport(current, comparison)).toContain('| quality | result | model | yes | fail | 2 |');
  });

  it('renders infrastructure diagnostics and rejects quality reporting or Baseline approval', () => {
    const result = invalidResult();

    expect(renderEvaluationDiagnostics(result)).toContain('grader unavailable');
    expect(() => renderEvaluationReport(result)).toThrow(/cannot be rendered as a quality report/iu);
    expect(() => approveBaseline({
      baselineId: 'baseline:invalid', result,
      approvedAt: '2026-01-01T00:00:02.000Z', approvedBy: 'developer',
    })).toThrow(/invalid Evaluation Runs/iu);
  });
});

function validResult(judgement: 'passed' | 'failed', metricJudgement: 'pass' | 'fail') {
  return EvaluationRunResultSchema.parse({
    ...runBase(), infrastructureStatus: 'valid',
    taskResults: [{
      ...taskBase(),
      productExecution: {
        operation: 'conversation',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:01.000Z',
        durationMs: 1_000,
        productResult: { reply: 'Done.' },
        businessIds: { executionId: 'execution:1' },
      },
      resultJudgement: judgement,
      processJudgement: 'passed',
      overallJudgement: judgement,
      infrastructureStatus: 'valid',
      metricResults: [{
        metricId: 'quality', title: 'Quality', dimension: 'result', evaluator: 'model', required: true,
        judgement: metricJudgement, score: metricJudgement === 'pass' ? 4 : 2,
        rationale: 'Result.', evidenceRefs: ['observation:1#productResult'],
        evaluatedAt: '2026-01-01T00:00:01.000Z',
      }],
    }],
    totals: qualityTotals({ result: judgement, process: 'passed', overall: judgement }),
  });
}

function invalidResult() {
  return EvaluationRunResultSchema.parse({
    ...runBase(), infrastructureStatus: 'invalid',
    taskResults: [{
      ...taskBase(),
      resultJudgement: 'not_evaluated', processJudgement: 'not_evaluated',
      overallJudgement: 'not_evaluated', infrastructureStatus: 'invalid', metricResults: [],
      infrastructureError: { code: 'model_grader_failed', message: 'grader unavailable' },
    }],
    totals: {
      ...qualityTotals({ result: 'not_evaluated', process: 'not_evaluated', overall: 'not_evaluated' }),
      invalid: 1,
    },
  });
}

function runBase() {
  return {
    runId: 'run:1', profile: 'controlled', startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z', candidateModel: 'test/candidate',
    graderModelAndMetricVersion: 'test/grader@v2',
    environment: {
      productVersion: '0.2.0', nodeVersion: 'v22', platform: 'win32', architecture: 'x64',
      suiteIds: [], repetitions: 1, concurrency: 1,
    },
  };
}

function taskBase() {
  return {
    taskRunId: 'conversation.task:r1', taskId: 'conversation.task', revision: 1,
    operation: 'conversation', difficulty: 'simple', profile: 'controlled',
    measurements: {
      durationMs: 1_000, inputTokens: 10, outputTokens: 5, modelCalls: 1, toolCalls: 0,
      sourceCalls: 0, retries: 0, candidatesProduced: 0, recommendationsPublished: 0,
      preferenceRevisions: 0, estimatedCostUsd: 0, graderModelCalls: 1, graderInputTokens: 10,
      graderOutputTokens: 5, graderEstimatedCostUsd: 0,
    },
    observationIssues: [],
  };
}

function qualityTotals(input: {
  readonly result: 'passed' | 'failed' | 'not_gradable' | 'not_evaluated';
  readonly process: 'passed' | 'failed' | 'not_gradable' | 'not_evaluated';
  readonly overall: 'passed' | 'failed' | 'not_gradable' | 'not_evaluated';
}) {
  const count = (judgement: typeof input.result) => ({
    passed: judgement === 'passed' ? 1 : 0,
    failed: judgement === 'failed' ? 1 : 0,
    notGradable: judgement === 'not_gradable' ? 1 : 0,
    notEvaluated: judgement === 'not_evaluated' ? 1 : 0,
  });
  return {
    result: count(input.result),
    process: count(input.process),
    overall: count(input.overall),
    invalid: 0,
    budgetBlocked: 0,
  };
}
