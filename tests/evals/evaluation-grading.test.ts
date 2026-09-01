/* Verifies declared Metric dispatch and separation of Grader infrastructure failures. */
import { describe, expect, it } from 'vitest';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { gradeTask } from '../../evals/agent/grading/grade-task';
import type { ModelMetricEvaluator } from '../../evals/agent/grading/model-grader';
import { TaskObservationSchema } from '../../evals/agent/execution/observe-task';

describe('Evaluation grading', () => {
  it('grades Rule, Model, and Measurement Metrics in Task order', async () => {
    const task = evaluationTask();
    const modelEvaluator: ModelMetricEvaluator = {
      async evaluate({ metrics, now }) {
        return {
          results: metrics.map((metric) => ({
            metricId: metric.metricId, title: metric.title, evaluator: 'model' as const,
            required: metric.required, judgement: 'pass' as const, score: 4,
            rationale: 'Strong result.', evidenceRefs: ['observation:1#productResult'], evaluatedAt: now,
          })),
          usage: { modelCalls: 1, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0 },
        };
      },
    };

    const result = await gradeTask({
      task,
      observation: observation(),
      modelEvaluator,
      now: '2026-01-01T00:00:02.000Z',
    });

    expect(result.results.map((entry) => entry.metricId)).toEqual(['file', 'quality', 'tools']);
    expect(result.results.every((entry) => entry.judgement === 'pass')).toBe(true);
    expect(result.modelUsage.modelCalls).toBe(1);
    expect(result.infrastructureError).toBeUndefined();
  });

  it('preserves deterministic results but marks a Model Grader failure as infrastructure invalidity', async () => {
    const failingEvaluator: ModelMetricEvaluator = {
      async evaluate() { throw new Error('grader unavailable'); },
    };

    const result = await gradeTask({
      task: evaluationTask(),
      observation: observation(),
      modelEvaluator: failingEvaluator,
      now: '2026-01-01T00:00:02.000Z',
    });

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricId: 'file', judgement: 'pass' }),
      expect.objectContaining({ metricId: 'quality', judgement: 'not_gradable' }),
      expect.objectContaining({ metricId: 'tools', judgement: 'pass' }),
    ]));
    expect(result.infrastructureError).toMatchObject({ code: 'model_grader_failed' });
  });

  it('marks an unavailable Measurement as not gradable instead of comparing a synthetic zero', async () => {
    const result = await gradeTask({
      task: evaluationTask(),
      observation: observation(['toolCalls']),
      modelEvaluator: {
        async evaluate({ metrics, now }) {
          return {
            results: metrics.map((metric) => ({
              metricId: metric.metricId, title: metric.title, evaluator: 'model' as const,
              required: metric.required, judgement: 'pass' as const, score: 4,
              rationale: 'Strong result.', evidenceRefs: [], evaluatedAt: now,
            })),
            usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          };
        },
      },
      now: '2026-01-01T00:00:02.000Z',
    });

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricId: 'tools', judgement: 'not_gradable' }),
    ]));
  });
});

function evaluationTask() {
  return EvaluationTaskSchema.parse({
    taskId: 'conversation.metric-contract', revision: 1, title: 'Metric contract',
    objective: 'Validate Metric dispatch.', difficulty: 'simple', profiles: ['controlled'], tags: [],
    initialState: {
      clock: '2026-01-01T00:00:00.000Z', workspaceFiles: [], sessions: [], interests: [],
      candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
    },
    input: {
      type: 'conversation',
      steps: [{ userInput: 'Create a file.', permissionMode: 'full_access' }],
    },
    timeoutMs: 1_000,
    metrics: [
      { metricId: 'file', title: 'File exists', evaluator: 'rule', rule: 'workspace_files_exist', paths: ['out.md'], required: true },
      { metricId: 'quality', title: 'Quality', evaluator: 'model', rubric: 'Judge quality.', minScore: 3, required: true },
      { metricId: 'tools', title: 'Tool calls', evaluator: 'measurement', measurement: 'toolCalls', operator: 'min', threshold: 1, required: true },
    ],
  });
}

function observation(unavailable: readonly ('toolCalls')[] = []) {
  const measurements = {
    durationMs: 100, inputTokens: 0, outputTokens: 0, modelCalls: 1, toolCalls: 2,
    sourceCalls: 0, retries: 0, candidatesProduced: 0, recommendationsPublished: 0,
    preferenceRevisions: 0, estimatedCostUsd: 0, graderModelCalls: 0, graderInputTokens: 0,
    graderOutputTokens: 0, graderEstimatedCostUsd: 0, unavailable,
  };
  return TaskObservationSchema.parse({
    observationId: 'observation:1',
    taskId: 'conversation.metric-contract',
    operation: 'conversation',
    profile: 'controlled',
    collectedAt: '2026-01-01T00:00:01.000Z',
    environment: {},
    input: { type: 'conversation' },
    executionOutcome: { status: 'completed' },
    productResult: { reply: 'Done.' },
    artifacts: { workspaceFiles: { 'out.md': '# Result' } },
    traceTargets: [{
      traceKind: 'conversation', correlation: { executionId: 'execution:1' }, expectation: 'required',
    }],
    traceIds: ['trace:1'],
    traceSummaries: [],
    evidence: {
      input: { task: { type: 'conversation' }, business: {}, traceContent: [] },
      context: { business: {}, traceContent: [] },
      execution: { outcome: { status: 'completed' }, traces: [], business: {}, traceContent: [] },
      output: {
        productResult: { reply: 'Done.' }, workspaceFiles: { 'out.md': '# Result' },
        business: {}, traceContent: [],
      },
      measurement: measurements,
    },
    measurements,
    issues: [],
  });
}
