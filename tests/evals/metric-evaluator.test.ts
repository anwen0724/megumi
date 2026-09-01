/* Verifies each Task Metric is evaluated by its declared mechanism and keeps Task order. */
import { describe, expect, it } from 'vitest';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { evaluateTaskMetrics } from '../../evals/agent/metrics/metric-evaluator';
import type { ModelMetricEvaluator } from '../../evals/agent/metrics/model-metric-evaluator';
import { EvidenceBundleSchema } from '../../evals/agent/runtime/evidence-collector';

describe('Evaluation Metric evaluator', () => {
  it('combines Rule, Model, and Measurement results in declared order', async () => {
    const task = EvaluationTaskSchema.parse({
      taskId: 'conversation.metric-contract', revision: 1, title: 'Metric contract',
      objective: 'Validate Metric dispatch.', difficulty: 'simple', profiles: ['controlled'], tags: [],
      runner: 'conversation', scenario: scenario(),
      steps: [{ userInput: 'Create a file.', permissionMode: 'full_access' }],
      completion: { kind: 'conversation_steps_terminal', timeoutMs: 1_000 },
      metrics: [
        { metricId: 'file', title: 'File exists', evaluator: 'rule', rule: 'workspace_files_exist', paths: ['out.md'], required: true },
        { metricId: 'quality', title: 'Quality', evaluator: 'model', rubric: 'Judge quality.', minScore: 3, required: true },
        { metricId: 'tools', title: 'Tool calls', evaluator: 'measurement', measurement: 'toolCalls', operator: 'min', threshold: 1, required: true },
      ],
    });
    const evidence = EvidenceBundleSchema.parse({
      evidenceId: 'evidence:1', taskId: task.taskId, runner: task.runner, profile: 'controlled',
      collectedAt: '2026-01-01T00:00:01.000Z', environment: {}, input: {}, beforeFacts: {},
      completion: { status: 'done' }, afterFacts: { workspaceFiles: { 'out.md': '# Result' } },
      traces: [], runtimeEvents: [], measurements: measurements({ toolCalls: 2 }), issues: [],
    });
    const modelEvaluator: ModelMetricEvaluator = {
      async evaluate({ metrics, now }) {
        return {
          results: metrics.map((metric) => ({
            metricId: metric.metricId, title: metric.title, evaluator: 'model' as const,
            required: metric.required, judgement: 'pass' as const, score: 4,
            rationale: 'Strong result.', evidenceRefs: ['evidence:1#afterFacts'], evaluatedAt: now,
          })),
          usage: { modelCalls: 1, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0 },
        };
      },
    };
    const result = await evaluateTaskMetrics({
      task, evidence, modelEvaluator, now: '2026-01-01T00:00:02.000Z',
    });
    expect(result.results.map((entry) => entry.metricId)).toEqual(['file', 'quality', 'tools']);
    expect(result.results.every((entry) => entry.judgement === 'pass')).toBe(true);
    expect(result.modelUsage.modelCalls).toBe(1);
  });
});

function scenario() {
  return {
    clock: '2026-01-01T00:00:00.000Z', workspace: { files: [] }, sessions: [], interests: [],
    candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
  };
}

function measurements(overrides: Readonly<Record<string, number>> = {}) {
  return {
    durationMs: 100, inputTokens: 0, outputTokens: 0, modelCalls: 1, toolCalls: 0,
    sourceCalls: 0, retries: 0, candidatesProduced: 0, recommendationsPublished: 0,
    preferenceRevisions: 0, estimatedCostUsd: 0, graderModelCalls: 0, graderInputTokens: 0,
    graderOutputTokens: 0, graderEstimatedCostUsd: 0, ...overrides,
  };
}
