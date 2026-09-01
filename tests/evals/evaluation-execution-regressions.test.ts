/* Protects initial-state Candidate details and real Conversation terminal-state interpretation. */
// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProductRuntime } from '@megumi/composition';
import { afterEach, describe, expect, it } from 'vitest';
import { EvaluationInitialStateSchema, EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { executeTask } from '../../evals/agent/execution/execute-task';
import { collectTraceEvidence } from '../../evals/agent/execution/trace-evidence';
import {
  createDatabaseInitialStateOwner,
  installInitialState,
} from '../../evals/agent/execution/initial-state';

let temporaryRoot: string | undefined;
afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('Evaluation execution regressions', () => {
  it('installs Candidate full content before admission through the real repository lifecycle', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'megumi-evaluation-initial-state-'));
    const homePath = path.join(temporaryRoot, 'home');
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    await mkdir(path.join(homePath, 'sqlite'), { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    const initialState = EvaluationInitialStateSchema.parse({
      clock: '2026-01-01T00:00:00.000Z',
      workspaceFiles: [], sessions: [], recommendations: [], preferences: [], controlledSearch: [],
      permissionDecision: 'allow',
      interests: [{ referenceId: 'typescript', description: 'TypeScript engineering', status: 'active' }],
      candidates: [{
        referenceId: 'article', sourceId: 'open_web', sourceName: 'Open Web',
        canonicalUrl: 'https://example.test/article', title: 'TypeScript article',
        description: 'Summary', contentText: 'Complete article body.',
        matchedInterestReferenceIds: ['typescript'], relevance: 'direct',
      }],
    });
    const databaseOwner = createDatabaseInitialStateOwner({
      homePath,
      migrationsFolder: path.join(process.cwd(), 'packages', 'agent', 'database', 'migrations'),
      now: initialState.clock,
    });
    try {
      const installed = await installInitialState({ initialState, workspaceRoot, owner: databaseOwner.owner });
      expect(installed.candidates.article).toMatch(/^candidate:/u);
    } finally {
      databaseOwner.close();
    }
  });

  it('installs the domain-rich initial states used by recommendation and preference Tasks', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'megumi-evaluation-task-state-'));
    const files = [
      'daily-recommendation/novel-diverse-selection.json',
      'daily-recommendation/preference-aware-selection.json',
      'preference-learning/preference-correction.json',
      'preference-learning/preference-retraction.json',
    ];
    for (const [index, file] of files.entries()) {
      const task = EvaluationTaskSchema.parse(JSON.parse(await readFile(
        path.join(process.cwd(), 'evals', 'agent', 'tasks', file),
        'utf8',
      )));
      const homePath = path.join(temporaryRoot, String(index), 'home');
      const workspaceRoot = path.join(temporaryRoot, String(index), 'workspace');
      await mkdir(path.join(homePath, 'sqlite'), { recursive: true });
      await mkdir(workspaceRoot, { recursive: true });
      const databaseOwner = createDatabaseInitialStateOwner({
        homePath,
        migrationsFolder: path.join(process.cwd(), 'packages', 'agent', 'database', 'migrations'),
        now: task.initialState.clock,
      });
      try {
        await expect(installInitialState({
          initialState: task.initialState,
          workspaceRoot,
          owner: databaseOwner.owner,
        })).resolves.toBeDefined();
      } finally {
        databaseOwner.close();
      }
    }
  });

  it('treats a committed failed Assistant Reply as product failure rather than completion', async () => {
    const task = EvaluationTaskSchema.parse({
      taskId: 'conversation.failed-reply', revision: 1, title: 'Failed reply',
      objective: 'Observe a failed product reply.', difficulty: 'simple', profiles: ['controlled'], tags: [],
      initialState: {
        clock: '2026-01-01T00:00:00.000Z', workspaceFiles: [], sessions: [], interests: [],
        candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
      },
      input: { type: 'conversation', steps: [{ userInput: 'Do the task.', permissionMode: 'auto' }] },
      timeoutMs: 1_000,
      metrics: [{
        metricId: 'completion', title: 'Completion', evaluator: 'rule',
        rule: 'business_completion_present', required: true,
      }],
    });
    const runtime = {
      host: {
        session: {
          async sendUserInput() {
            return {
              payload: {
                type: 'agent_run',
                session: { id: 'session:1' },
                run: { executionId: 'execution:1' },
                userMessageId: 'message:1',
              },
            };
          },
          async readCommittedRun() {
            return {
              status: 'ok',
              messages: [{
                type: 'message',
                entryId: 'entry:1',
                message: {
                  kind: 'assistantReply', status: 'failed', reasonCode: 'model_call_failed',
                },
              }],
            };
          },
        },
      },
    } as unknown as ProductRuntime;

    const execution = await executeTask({
      task,
      runtime,
      initialStateIds: {
        workspaceId: 'workspace:1', sessions: {}, interests: {}, candidates: {},
        recommendations: {}, preferenceRevisions: [],
      },
      candidateModel: { providerId: 'test', modelId: 'test' },
      now: () => task.initialState.clock,
    });

    expect(execution.outcome).toEqual({
      status: 'failed',
      message: 'Assistant Reply failed: model_call_failed.',
    });
    expect(execution.traceTargets).toEqual([expect.objectContaining({
      traceKind: 'conversation',
      correlation: expect.objectContaining({ executionId: 'execution:1' }),
      expectation: 'required',
    })]);
  });

  it('does not query an empty Candidate Supply Trace when the Pool has no gap', async () => {
    const task = operationTask('candidate_supply');
    const runtime = {
      host: { discovery: {
        async requestCandidateSupply() {
          return {
            candidateSupplyId: 'candidate-supply:1', trigger: 'evaluation', status: 'queued',
            requestedAt: task.initialState.clock,
          };
        },
        async waitCandidateSupplyCheck() {
          return { status: 'completed', value: {
            candidateSupplyId: 'candidate-supply:1', trigger: 'evaluation', status: 'completed',
            reason: 'no_gap', requestedAt: task.initialState.clock, completedAt: task.initialState.clock,
          } };
        },
      } },
    } as unknown as ProductRuntime;

    const execution = await executeTask(executionInput(task, runtime));

    expect(execution.outcome).toEqual({ status: 'completed' });
    expect(execution.traceTargets).toEqual([]);
    expect(execution.businessMeasurements).toEqual({ candidatesProduced: 0 });
  });

  it('associates an executed Candidate Supply with both stable business and execution IDs', async () => {
    const task = operationTask('candidate_supply');
    const runtime = {
      host: { discovery: {
        async requestCandidateSupply() {
          return {
            candidateSupplyId: 'candidate-supply:1', trigger: 'evaluation', status: 'queued',
            requestedAt: task.initialState.clock,
          };
        },
        async waitCandidateSupplyCheck() {
          return { status: 'completed', value: {
            candidateSupplyId: 'candidate-supply:1', trigger: 'evaluation', status: 'completed',
            reason: 'fulfilled', executionId: 'execution:1', availableBefore: 2, availableAfter: 5,
            requestedAt: task.initialState.clock, startedAt: task.initialState.clock,
            completedAt: task.initialState.clock,
          } };
        },
        async getCandidateSupplyFacts() { return { status: 'failed', failure: { code: 'missing', message: 'missing' } }; },
      } },
    } as unknown as ProductRuntime;

    const execution = await executeTask(executionInput(task, runtime));

    expect(execution.traceTargets).toEqual([{
      traceKind: 'candidate_supply',
      correlation: { candidateSupplyId: 'candidate-supply:1', executionId: 'execution:1' },
      expectation: 'required',
    }]);
    expect(execution.businessMeasurements).toEqual({ candidatesProduced: 3 });
  });

  it('keeps Daily Recommendation history separate from the current published batch', async () => {
    const task = operationTask('daily_recommendation');
    const runtime = {
      host: { discovery: {
        async ensureDaily() {
          return {
            status: 'started', localDate: '2026-01-01', batchId: 'daily-batch:1',
            executionId: 'execution:daily', requestedCount: 2, actualTarget: 2,
          };
        },
        async waitDailyBatch() {
          return { status: 'completed', value: {
            status: 'published', localDate: '2026-01-01', batchId: 'daily-batch:1',
            executionId: 'execution:daily', timezone: 'UTC', requestedCount: 2, actualTarget: 2,
            attemptCount: 1, automaticRetryCount: 0, resultCount: 2,
            createdAt: task.initialState.clock, updatedAt: task.initialState.clock,
            startedAt: task.initialState.clock, publishedAt: task.initialState.clock,
          } };
        },
        async getDailyRecommendationFacts() {
          return { status: 'ok', facts: {
            recentRecommendations: [{ title: 'Earlier recommendation' }],
          } };
        },
      } },
    } as unknown as ProductRuntime;

    const execution = await executeTask(executionInput(task, runtime));

    expect(execution.traceTargets).toEqual([{
      traceKind: 'daily_recommendation',
      correlation: {
        dailyRecommendationBatchId: 'daily-batch:1', executionId: 'execution:daily',
      },
      expectation: 'required',
    }]);
    expect(execution.evidence).toMatchObject({
      context: { recentRecommendations: [{ title: 'Earlier recommendation' }] },
      output: { currentBatch: { batchId: 'daily-batch:1', resultCount: 2 } },
    });
    expect(execution.businessMeasurements).toEqual({ recommendationsPublished: 2 });
  });

  it('associates Preference Learning by its batch and preserves before-and-after revisions', async () => {
    const task = EvaluationTaskSchema.parse(JSON.parse(await readFile(
      path.join(process.cwd(), 'evals', 'agent', 'tasks', 'preference-learning', 'preference-correction.json'),
      'utf8',
    )));
    if (task.input.type !== 'preference_learning') throw new Error('Preference Learning Task is required.');
    const runtime = {
      host: { discovery: {
        async updateRecommendationState() {
          return {
            recommendation: {},
            feedbackChange: {
              changed: true, recommendationId: 'recommendation:1', feedbackChangeId: 'feedback-change:1',
              status: 'pending', changedAt: task.initialState.clock,
            },
          };
        },
        async waitPreferenceLearning() {
          return { status: 'completed', value: {
            feedbackChangeId: 'feedback-change:1', status: 'learned', batchId: 'preference-batch:1',
            resultRevisions: [{ scopeKey: 'interest:1', revision: 2 }],
            changedAt: task.initialState.clock, completedAt: task.initialState.clock,
          } };
        },
        async getPreferenceLearningFacts() {
          return { status: 'ok', facts: {
            currentPreferences: [{ scopeKey: 'interest:1', revision: 1 }],
            feedbackChanges: [{ feedbackChangeId: 'feedback-change:1' }],
          } };
        },
      } },
    } as unknown as ProductRuntime;

    const execution = await executeTask({
      ...executionInput(task, runtime),
      initialStateIds: {
        workspaceId: 'workspace:1', sessions: {}, interests: {}, candidates: {},
        recommendations: { [task.input.recommendationReferenceId]: 'recommendation:1' },
        preferenceRevisions: [],
      },
    });

    expect(execution.traceTargets).toEqual([{
      traceKind: 'preference_learning',
      correlation: { preferenceLearningBatchId: 'preference-batch:1' },
      expectation: 'required',
    }]);
    expect(execution.evidence).toMatchObject({
      input: { batchFeedback: [{ feedbackChangeId: 'feedback-change:1' }] },
      context: { preferenceRevisionsBefore: [{ scopeKey: 'interest:1', revision: 1 }] },
      output: { preferenceRevisionsAfter: [{ scopeKey: 'interest:1', revision: 2 }] },
    });
  });

  it('reports Product Host Trace query failures instead of converting them to a missing Trace', async () => {
    const runtime = {
      host: { observability: {
        async flush() {},
        async listTraces() { return { status: 'failed', message: 'index unavailable' }; },
      } },
    } as unknown as ProductRuntime;

    const evidence = await collectTraceEvidence({
      runtime,
      targets: [{
        traceKind: 'conversation', correlation: { executionId: 'execution:1' }, expectation: 'required',
      }],
      settlementTimeoutMs: 0,
    });

    expect(evidence.issues).toEqual([expect.objectContaining({
      code: 'trace_query_failed', impact: 'not_gradable',
    })]);
    expect(evidence.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'correlated_trace_missing' }),
    ]));
    expect(evidence.measurements.unavailable).toContain('inputTokens');
  });
});

function operationTask(type: 'candidate_supply' | 'daily_recommendation') {
  return EvaluationTaskSchema.parse({
    taskId: `evaluation.${type}`, revision: 1, title: type,
    objective: `Execute ${type}.`, difficulty: 'simple', profiles: ['controlled'], tags: [],
    initialState: {
      clock: '2026-01-01T00:00:00.000Z', workspaceFiles: [], sessions: [], interests: [],
      candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
    },
    input: { type }, timeoutMs: 1_000,
    metrics: [{
      metricId: 'completion', title: 'Completion', evaluator: 'rule',
      rule: 'business_completion_present', required: true,
    }],
  });
}

function executionInput(task: ReturnType<typeof operationTask> | ReturnType<typeof EvaluationTaskSchema.parse>, runtime: ProductRuntime) {
  return {
    task,
    runtime,
    initialStateIds: {
      workspaceId: 'workspace:1', sessions: {}, interests: {}, candidates: {},
      recommendations: {}, preferenceRevisions: [],
    },
    candidateModel: { providerId: 'test', modelId: 'test' },
    now: () => task.initialState.clock,
  };
}
