/* Verifies one Task uses the real shared ProductRuntime and persists a compact Observation. */
// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvaluationRunConfigSchema } from '../../evals/agent/contracts/evaluation-run-config';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { createEvaluationHost } from '../../evals/agent/execution/evaluation-host';
import { projectExecutionProcess } from '../../evals/agent/execution/execution-process';
import { runEvaluation } from '../../evals/agent/execution/run-evaluation';
import type { EvaluationTaskCatalog } from '../../evals/agent/execution/task-loader';
import type { ModelMetricEvaluator } from '../../evals/agent/grading/model-grader';
import { createScriptedStreams } from '../packages/composition/compose-test-application';

let temporaryRoot: string | undefined;
afterEach(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('Evaluation execution', () => {
  it('calls the same ProductRuntime host and stores Observation references instead of copied Trace records', async () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'megumi-evaluation-execution-'));
    const task = evaluationTask();
    const catalog: EvaluationTaskCatalog = {
      tasks: new Map([[task.taskId, task]]),
      suites: new Map(),
      resolveTasks: () => [task],
    };
    const config = EvaluationRunConfigSchema.parse({
      profile: 'controlled', taskIds: [task.taskId], suiteIds: [],
      candidateModel: { source: 'current' }, graderModel: { source: 'current' },
      repetitions: 1, concurrency: 1, budget: { maxTasks: 1 },
    });
    const model = resolvedModel();
    const scripted = createScriptedStreams(['The requested task is complete.']);

    const { result, storage } = await runEvaluation({
      repositoryRoot: process.cwd(), evaluationRoot: temporaryRoot, catalog, config,
      models: { candidate: model, grader: model },
      dependencies: {
        createRunId: () => 'run:test',
        now: monotonicClock(),
        modelMetricEvaluator: noModelMetrics,
        createHost: (input) => createEvaluationHost({
          ...input,
          modelStreams: { 'openai-completions': scripted.streams },
        }),
      },
    });

    expect(result).toMatchObject({
      infrastructureStatus: 'valid',
      totals: {
        result: { passed: 1, failed: 0 },
        overall: { passed: 0, notEvaluated: 1 },
        invalid: 0,
      },
      taskResults: [{
        operation: 'conversation',
        productExecution: { operation: 'conversation' },
        resultJudgement: 'passed',
        processJudgement: 'not_evaluated',
        overallJudgement: 'not_evaluated',
        infrastructureStatus: 'valid',
      }],
    });
    expect(storage.runDirectory).toBe(path.join(temporaryRoot, 'runs', 'run_test'));
    const observationPath = result.taskResults[0]?.observationPath;
    expect(observationPath).toBeTruthy();
    const observation: unknown = JSON.parse(readFileSync(observationPath!, 'utf8'));
    expect(observation).toMatchObject({
      traceIds: [expect.any(String)],
      executionProcess: {
        attempts: [{
          executionId: expect.any(String),
          traces: [{ steps: expect.any(Array) }],
        }],
      },
    });
    expect(JSON.stringify(observation)).not.toContain('"records"');
    expect(existsSync(path.join(storage.runDirectory, 'evidence'))).toBe(false);
    expect(readFileSync(path.join(storage.runDirectory, 'manifest.json'), 'utf8')).not.toContain('test-key');
  });

  it('projects normal Trace details into attempts without inventing cross-Trace order', () => {
    const process = projectExecutionProcess([
      traceDetail({
        traceId: 'trace:attempt-1',
        executionId: 'execution:attempt-1',
        spanId: 'span:tool',
        spanName: 'tool.call',
        toolName: 'read_file',
        contentKinds: ['tool.arguments', 'tool.result'],
      }),
      traceDetail({
        traceId: 'trace:attempt-2',
        executionId: 'execution:attempt-2',
        spanId: 'span:source',
        spanName: 'source.search',
        contentKinds: ['source.request', 'source.result'],
      }),
    ]);

    expect(process.attempts).toHaveLength(2);
    expect(process.attempts[0]).toMatchObject({
      attemptId: 'execution:attempt-1',
      executionId: 'execution:attempt-1',
      traces: [{
        traceId: 'trace:attempt-1',
        steps: [{
          sequence: 2,
          category: 'tool',
          name: 'read_file',
          status: 'ok',
          contentRefs: [
            { traceId: 'trace:attempt-1', sequence: 2, kind: 'tool.arguments' },
            { traceId: 'trace:attempt-1', sequence: 4, kind: 'tool.result' },
          ],
        }],
      }],
    });
    expect(process.attempts[1]?.traces[0]?.steps[0]).toMatchObject({
      category: 'source',
      name: 'source.search',
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
    taskId: 'conversation.execution-contract', revision: 1, title: 'Execution contract',
    objective: 'Complete a real Conversation Execution.', difficulty: 'simple', profiles: ['controlled'], tags: [],
    initialState: {
      clock: '2026-01-01T00:00:00.000Z', workspaceFiles: [], sessions: [], interests: [],
      candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
    },
    input: {
      type: 'conversation',
      steps: [{ userInput: 'Complete the requested task.', permissionMode: 'full_access' }],
    },
    metrics: [
      { metricId: 'completion', title: 'Completion', dimension: 'result', evaluator: 'rule', rule: 'business_completion_present', required: true },
    ],
  });
}

function resolvedModel() {
  const credential = { type: 'api_key' as const, key: 'test-key' };
  return {
    source: 'custom' as const,
    config: {
      providerId: 'test', modelId: 'model', api: 'openai-completions' as const,
      baseUrl: 'https://example.test/v1', displayName: 'Test model',
      contextWindowTokens: 64_000, maxOutputTokens: 2_048,
    },
    credentials: {
      async read(providerId: string) { return providerId === 'test' ? credential : undefined; },
      async list() { return [{ providerId: 'test', type: 'api_key' as const }]; },
      async modify() { throw new Error('read-only'); },
      async delete() { throw new Error('read-only'); },
    },
  };
}

function monotonicClock(): () => Date {
  let milliseconds = Date.parse('2026-01-01T00:00:00.000Z');
  return () => new Date(milliseconds++);
}

function traceDetail(input: {
  readonly traceId: string;
  readonly executionId: string;
  readonly spanId: string;
  readonly spanName: string;
  readonly toolName?: string;
  readonly contentKinds: readonly string[];
}) {
  const startedAt = '2026-01-01T00:00:00.000Z';
  return {
    summary: {
      traceId: input.traceId,
      traceKind: 'daily_recommendation' as const,
      status: 'completed' as const,
      diagnostics: 'complete' as const,
      correlation: {
        dailyRecommendationBatchId: 'daily-batch:1',
        executionId: input.executionId,
      },
      startedAt,
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1_000,
      spanCount: 1,
      eventCount: 1,
      contentCount: input.contentKinds.length,
      issueCount: 0,
    },
    outcome: { status: 'ok' as const },
    spans: [{
      spanId: input.spanId,
      name: input.spanName,
      ...(input.toolName ? { metadata: { kind: 'tool_call' as const, toolName: input.toolName } } : {}),
      correlation: { executionId: input.executionId },
      startedAt,
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1_000,
      outcome: { status: 'ok' as const },
      events: [{ sequence: 3, timestamp: startedAt, type: 'test.event', detail: {} }],
    }],
    contents: input.contentKinds.map((kind, index) => ({
      sequence: 2 + (index * 2), timestamp: startedAt, spanId: input.spanId,
      kind, mode: 'inline' as const, mediaType: 'application/json', byteLength: 2,
      correlation: { executionId: input.executionId },
    })),
    links: [],
    issues: [],
    sourceFiles: ['trace.jsonl'],
  };
}
