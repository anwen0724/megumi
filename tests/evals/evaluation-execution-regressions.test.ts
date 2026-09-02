/* Protects owner-returned completion facts, stable Trace association, and safety interruption semantics. */
// @vitest-environment node
import type { ProductRuntime } from '@megumi/composition';
import { describe, expect, it } from 'vitest';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { executeTask } from '../../evals/agent/execution/execute-task';

describe('Evaluation execution regressions', () => {
  it('preserves a committed failed Assistant Reply instead of inventing an Evaluation failure status', async () => {
    const task = operationTask('conversation');
    const runtime = {
      host: { session: {
        async sendUserInput() {
          return {
            payload: {
              type: 'agent_run', session: { id: 'session:1' },
              run: { executionId: 'execution:1' }, userMessageId: 'message:1',
            },
          };
        },
        async readCommittedRun() {
          return {
            status: 'ok',
            messages: [{
              type: 'message', entryId: 'entry:1',
              message: { kind: 'assistantReply', status: 'failed', reasonCode: 'model_call_failed' },
            }],
          };
        },
      } },
    } as unknown as ProductRuntime;

    const execution = await executeTask(executionInput(task, runtime));

    expect(execution).not.toHaveProperty('outcome');
    expect(execution.productResult).toMatchObject({
      steps: [{
        status: 'ok',
        messages: [{ message: { kind: 'assistantReply', status: 'failed', reasonCode: 'model_call_failed' } }],
      }],
    });
    expect(execution.businessIds).toEqual({
      sessionId: 'session:1',
      executionIds: ['execution:1'],
    });
  });

  it('associates Daily Recommendation with the stable batch instead of its first Attempt', async () => {
    const task = operationTask('daily_recommendation');
    const factsExecutionIds: string[] = [];
    const runtime = {
      host: { discovery: {
        async ensureDaily() {
          return {
            status: 'started', localDate: '2026-01-01', batchId: 'daily-batch:1',
            executionId: 'execution:first', requestedCount: 2, actualTarget: 2,
          };
        },
        async waitDailyBatch() {
          return { status: 'completed', value: {
            status: 'published', localDate: '2026-01-01', batchId: 'daily-batch:1',
            executionId: 'execution:second', timezone: 'UTC', requestedCount: 2, actualTarget: 2,
            attemptCount: 2, automaticRetryCount: 1, resultCount: 2,
            createdAt: task.initialState.clock, updatedAt: task.initialState.clock,
            startedAt: task.initialState.clock, publishedAt: task.initialState.clock,
          } };
        },
        async getDailyRecommendationFacts(request: { readonly executionId: string }) {
          factsExecutionIds.push(request.executionId);
          return { status: 'ok', facts: { recentRecommendations: [] } };
        },
      } },
    } as unknown as ProductRuntime;

    const execution = await executeTask(executionInput(task, runtime));

    expect(execution.traceTargets).toEqual([{
      traceKind: 'daily_recommendation',
      correlation: { dailyRecommendationBatchId: 'daily-batch:1' },
      expectation: 'required',
    }]);
    expect(execution.businessIds).toEqual({
      dailyRecommendationBatchId: 'daily-batch:1',
      initialExecutionId: 'execution:first',
      settledExecutionId: 'execution:second',
    });
    expect(factsExecutionIds).toEqual(['execution:second']);
    expect(execution.productResult).toMatchObject({
      completion: { status: 'published', executionId: 'execution:second', attemptCount: 2 },
    });
  });

  it('preserves a failed Preference Learning completion and all still-supporting feedback', async () => {
    const task = preferenceTask();
    const runtime = preferenceRuntime(task);

    const execution = await executeTask(executionInput(task, runtime, {
      recommendations: { recommendation: 'recommendation:1' },
    }));

    expect(execution).not.toHaveProperty('outcome');
    expect(execution.productResult).toMatchObject({
      completion: {
        status: 'failed',
        batchId: 'preference-batch:1',
        failure: { code: 'scope_mismatch', message: 'Preference Learning commit was rejected.' },
      },
    });
    expect(execution.evidence).toMatchObject({
      context: {
        preferencesBefore: [{ directionId: 'direction:old' }],
      },
      output: {
        preferencesAfter: [{
          scopeKey: 'interest:1',
          directions: [{
            directionId: 'direction:old',
            supportingFeedbackIds: ['feedback:remaining'],
          }],
        }],
      },
    });
  });

  it('records the Evaluation safety guard separately from the product result', async () => {
    const task = operationTask('candidate_supply');
    const runtime = {
      host: { discovery: {
        async requestCandidateSupply() {
          return {
            candidateSupplyId: 'candidate-supply:1', trigger: 'evaluation', status: 'queued',
            requestedAt: task.initialState.clock,
          };
        },
        async waitCandidateSupplyCheck() { return { status: 'timed_out' }; },
      } },
    } as unknown as ProductRuntime;

    const execution = await executeTask({
      ...executionInput(task, runtime),
      safetyWallClockLimitMs: 1,
    });

    expect(execution.productResult).toMatchObject({
      receipt: { candidateSupplyId: 'candidate-supply:1' },
    });
    expect(execution.interruption).toEqual({
      source: 'evaluation_safety_guard',
      limitMs: 1,
    });
  });
});

function operationTask(type: 'conversation' | 'candidate_supply' | 'daily_recommendation') {
  return EvaluationTaskSchema.parse({
    taskId: `evaluation.${type}`, revision: 1, title: type,
    objective: `Execute ${type}.`, difficulty: 'simple', profiles: ['controlled'], tags: [],
    initialState: initialState(),
    input: type === 'conversation'
      ? { type, steps: [{ userInput: 'Do the task.', permissionMode: 'auto' }] }
      : { type },
    metrics: [{
      metricId: 'completion', title: 'Completion', dimension: 'result', evaluator: 'rule',
      rule: 'business_completion_present', required: true,
    }],
  });
}

function preferenceTask() {
  return EvaluationTaskSchema.parse({
    taskId: 'evaluation.preference-learning', revision: 1, title: 'preference learning',
    objective: 'Learn the updated preference.', difficulty: 'medium', profiles: ['controlled'], tags: [],
    initialState: {
      ...initialState(),
      recommendations: [{
        referenceId: 'recommendation', candidateReferenceId: 'candidate',
        reason: 'Relevant', reaction: 'liked',
      }],
      candidates: [{
        referenceId: 'candidate', sourceId: 'open_web', sourceName: 'Open Web',
        canonicalUrl: 'https://example.test/item', title: 'Item',
        matchedInterestReferenceIds: ['interest'], relevance: 'direct',
      }],
      interests: [{ referenceId: 'interest', description: 'TypeScript', status: 'active' }],
      preferences: [{
        scopeKey: 'interest:1', directionId: 'direction:old', polarity: 'positive',
        dimension: 'topic', statement: 'Prefer TypeScript',
        supportingRecommendationReferenceIds: ['recommendation'],
      }],
    },
    input: { type: 'preference_learning', recommendationReferenceId: 'recommendation', reaction: 'none' },
    metrics: [{
      metricId: 'completion', title: 'Completion', dimension: 'result', evaluator: 'rule',
      rule: 'business_completion_present', required: true,
    }],
  });
}

function initialState() {
  return {
    clock: '2026-01-01T00:00:00.000Z', workspaceFiles: [], sessions: [], interests: [],
    candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
  };
}

function executionInput(
  task: ReturnType<typeof EvaluationTaskSchema.parse>,
  runtime: ProductRuntime,
  initialStateIds: Partial<{
    workspaceId: string;
    sessions: Record<string, string>;
    interests: Record<string, string>;
    candidates: Record<string, string>;
    recommendations: Record<string, string>;
    preferenceRevisions: string[];
  }> = {},
) {
  return {
    task,
    runtime,
    initialStateIds: {
      workspaceId: 'workspace:1', sessions: {}, interests: {}, candidates: {},
      recommendations: {}, preferenceRevisions: [], ...initialStateIds,
    },
    candidateModel: { providerId: 'test', modelId: 'test' },
    now: () => task.initialState.clock,
    safetyWallClockLimitMs: 1_000,
  };
}

function preferenceRuntime(task: ReturnType<typeof preferenceTask>): ProductRuntime {
  return {
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
          feedbackChangeId: 'feedback-change:1', status: 'failed', batchId: 'preference-batch:1',
          resultRevisions: [],
          failure: { code: 'scope_mismatch', message: 'Preference Learning commit was rejected.' },
          changedAt: task.initialState.clock, completedAt: task.initialState.clock,
        } };
      },
      async getPreferenceLearningFacts() {
        return { status: 'ok', facts: {
          currentPreferences: [{
            scopeKey: 'interest:1', scope: 'interest', interestId: 'interest:1', revision: 2,
            directions: [{
              directionId: 'direction:old', polarity: 'positive', dimension: 'topic',
              statement: 'Prefer TypeScript', supportingFeedbackIds: ['feedback:remaining'],
              updatedAt: task.initialState.clock,
            }],
          }],
          feedbackChanges: [{ feedbackChangeId: 'feedback-change:1' }],
        } };
      },
    } },
  } as unknown as ProductRuntime;
}
