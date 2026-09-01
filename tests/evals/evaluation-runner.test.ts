/* Verifies the Runner executes one Task through real Product composition and Metric evaluation. */
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvaluationRunConfigSchema } from '../../evals/agent/contracts/evaluation-run-config';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import type { ModelMetricEvaluator } from '../../evals/agent/metrics/model-metric-evaluator';
import { runEvaluation } from '../../evals/agent/runtime/evaluation-runner';
import { composeEvaluationTask } from '../../evals/agent/runtime/task-environment';
import type { EvaluationTaskCatalog } from '../../evals/agent/runtime/task-loader';
import { createScriptedStreams } from '../packages/composition/compose-test-application';

let temporaryRoot: string | undefined;
afterEach(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('Agent Evaluation Runner', () => {
  it('runs one Task and persists a metric-centric result', async () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'megumi-evaluation-runner-'));
    const task = evaluationTask();
    const catalog: EvaluationTaskCatalog = {
      tasks: new Map([[task.taskId, task]]),
      suites: new Map(),
      resolveTasks: () => [task],
    };
    const config = EvaluationRunConfigSchema.parse({
      profile: 'controlled', taskIds: [task.taskId], suiteIds: [],
      candidateModel: modelConfig('CANDIDATE_KEY'), graderModel: modelConfig('GRADER_KEY'),
      repetitions: 1, concurrency: 1,
      budget: { maxTasks: 1, maxInputTokens: 1_000, maxOutputTokens: 1_000 },
      runRoot: temporaryRoot,
    });
    const scripted = createScriptedStreams(['The requested task is complete.']);
    const { result } = await runEvaluation({
      repositoryRoot: process.cwd(), catalog, config,
      dependencies: {
        createRunId: () => 'run:test',
        now: monotonicClock(),
        modelMetricEvaluator: noModelMetrics,
        composeTask: (input) => composeEvaluationTask({
          ...input,
          environment: { CANDIDATE_KEY: 'test-key' },
          modelStreams: { 'openai-completions': scripted.streams },
        }),
      },
    });
    expect(result.totals).toMatchObject({ passed: 1, evaluationErrors: 0, budgetBlocked: 0 });
    expect(result.taskResults[0]).toMatchObject({
      taskId: task.taskId,
      status: 'passed',
      metricResults: [
        expect.objectContaining({ metricId: 'completion', judgement: 'pass' }),
        expect.objectContaining({ metricId: 'trace', judgement: 'pass' }),
      ],
    });
  });
});

const noModelMetrics: ModelMetricEvaluator = {
  async evaluate() {
    return {
      results: [],
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
  },
};

function evaluationTask() {
  return EvaluationTaskSchema.parse({
    taskId: 'conversation.runner-contract', revision: 1, title: 'Runner contract',
    objective: 'Complete a real Conversation Execution.', difficulty: 'simple', profiles: ['controlled'], tags: [],
    runner: 'conversation',
    scenario: {
      clock: '2026-01-01T00:00:00.000Z', workspace: { files: [] }, sessions: [], interests: [],
      candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
    },
    steps: [{ userInput: 'Complete the requested task.', permissionMode: 'full_access' }],
    completion: { kind: 'conversation_steps_terminal', timeoutMs: 2_000 },
    metrics: [
      { metricId: 'completion', title: 'Completion', evaluator: 'rule', rule: 'business_completion_present', required: true },
      { metricId: 'trace', title: 'Trace', evaluator: 'rule', rule: 'trace_correlated', required: true },
    ],
  });
}

function modelConfig(apiKeyEnv: string) {
  return {
    providerId: 'test', modelId: 'model', api: 'openai-completions' as const, apiKeyEnv,
    baseUrl: 'https://example.test/v1', contextWindowTokens: 64_000, maxOutputTokens: 2_048,
  };
}

function monotonicClock(): () => Date {
  let milliseconds = Date.parse('2026-01-01T00:00:00.000Z');
  return () => new Date(milliseconds++);
}
