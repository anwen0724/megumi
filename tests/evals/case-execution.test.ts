/* Verifies that each Case driver uses the matching real Product Host contract and preserves Owner facts. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema, type EvaluationCase } from '../../evals/agent/contracts/evaluation-dataset';
import { executeCase } from '../../evals/agent/run/case-execution';

const now = '2026-01-15T08:00:00.000Z';
type TestRuntime = Parameters<typeof executeCase>[0]['runtime'];

describe('Case execution', () => {
  it('keeps every Conversation step in the same Session and waits for committed replies', async () => {
    const sessionInputs: Array<string | undefined> = [];
    let execution = 0;
    const runtime = testRuntime({
      session: {
        async sendUserInput(request) {
          execution += 1;
          sessionInputs.push(request.sessionId);
          return agentRun(`execution:${execution}`, 'session:1');
        },
        async readCommittedRun(request) {
          return committedReply(request.executionId);
        },
      },
    });

    const result = await executeCase(executionInput(conversationCase(), runtime));

    expect(sessionInputs).toEqual([undefined, 'session:1']);
    expect(result).toMatchObject({
      caseType: 'conversation', terminalState: 'settled',
      businessIds: { sessionId: 'session:1', executionIds: ['execution:1', 'execution:2'] },
      ownerFacts: { committedSteps: [{ status: 'ok' }, { status: 'ok' }] },
    });
  });

  it('waits for the terminal Interest Trace and reads final business facts by result IDs', async () => {
    const outcome = {
      outcome: 'evidence_committed' as const,
      changedInterestIds: ['interest:1'],
      evidenceIds: ['evidence:1'],
    };
    const runtime = testRuntime({
      session: {
        async sendUserInput() { return agentRun('execution:interest', 'session:source'); },
        async readCommittedRun(request) { return committedReply(request.executionId); },
      },
      discovery: {
        async getInterestFacts() {
          return {
            interests: [{
              interestId: 'interest:1', description: 'TypeScript', status: 'active',
              createdFrom: 'conversation', revision: 1, createdAt: now, updatedAt: now,
            }],
            evidence: [{
              evidenceId: 'evidence:1', interestId: 'interest:1', sessionId: 'session:source',
              messageId: 'message:user', description: 'TypeScript', effect: 'support',
              confidence: 'high', status: 'applied', createdAt: now, appliedAt: now,
            }],
          };
        },
      },
      observability: interestObservability(outcome),
    });

    const result = await executeCase(executionInput(interestCase(), runtime, {
      sessions: { source: 'session:source' },
    }));

    expect(result.businessIds).toMatchObject({
      executionId: 'execution:interest', interestIds: ['interest:1'], evidenceIds: ['evidence:1'],
    });
    expect(result.ownerFacts).toMatchObject({
      interests: [{ interestId: 'interest:1' }], evidence: [{ evidenceId: 'evidence:1' }],
    });
  });

  it('waits for Candidate Supply and reads final facts from its Owner query', async () => {
    const runtime = testRuntime({ discovery: {
      async requestCandidateSupply() {
        return { candidateSupplyId: 'supply:1', trigger: 'evaluation', status: 'queued', requestedAt: now };
      },
      async waitCandidateSupplyCheck() {
        return { status: 'completed', value: {
          candidateSupplyId: 'supply:1', trigger: 'evaluation', requestedAt: now,
          status: 'completed', reason: 'fulfilled', executionId: 'execution:supply', completedAt: now,
        } };
      },
      async getCandidateSupplyFacts() {
        return { status: 'failed', failure: { code: 'test_fact', message: 'Recorded Owner response.' } };
      },
    } });

    const result = await executeCase(executionInput(candidateCase(), runtime));

    expect(result.businessIds).toEqual({ candidateSupplyId: 'supply:1', executionId: 'execution:supply' });
    expect(result.ownerFacts).toEqual({
      status: 'failed', failure: { code: 'test_fact', message: 'Recorded Owner response.' },
    });
  });

  it('associates Daily Recommendation with the stable Batch and reads settled Owner facts', async () => {
    const runtime = testRuntime({ discovery: {
      async ensureDaily() {
        return {
          status: 'started', localDate: '2026-01-15', batchId: 'batch:1', executionId: 'execution:first',
          requestedCount: 1, actualTarget: 1,
        };
      },
      async waitDailyBatch() {
        return { status: 'completed', value: {
          status: 'published', batchId: 'batch:1', localDate: '2026-01-15', timezone: 'UTC',
          executionId: 'execution:settled', requestedCount: 1, actualTarget: 1, attemptCount: 2,
          automaticRetryCount: 1, resultCount: 1, createdAt: now, updatedAt: now, startedAt: now, publishedAt: now,
        } };
      },
      async getDailyRecommendationFacts() {
        return { status: 'failed', failure: { code: 'test_fact', message: 'Recorded Owner response.' } };
      },
    } });

    const result = await executeCase(executionInput(dailyCase(), runtime));

    expect(result.businessIds).toEqual({
      dailyRecommendationBatchId: 'batch:1',
      initialExecutionId: 'execution:first',
      settledExecutionId: 'execution:settled',
    });
    expect(result.traceTargets).toEqual([{
      traceKind: 'daily_recommendation', correlation: { dailyRecommendationBatchId: 'batch:1' },
      expectation: 'required',
    }]);
  });

  it('submits Reaction, waits for Preference Learning, and preserves final Owner facts', async () => {
    const runtime = testRuntime({ discovery: {
      async updateRecommendationState() {
        return {
          recommendation: recommendationView(),
          feedbackChange: {
            changed: true, recommendationId: 'recommendation:1', feedbackChangeId: 'feedback-change:1',
            status: 'pending', changedAt: now,
          },
        };
      },
      async waitPreferenceLearning() {
        return { status: 'completed', value: {
          feedbackChangeId: 'feedback-change:1', status: 'learned', batchId: 'preference-batch:1',
          resultRevisions: [{ scopeKey: 'interest:1', revision: 1 }], changedAt: now, completedAt: now,
        } };
      },
      async getPreferenceLearningFacts() {
        return { status: 'failed', failure: { code: 'test_fact', message: 'Recorded Owner response.' } };
      },
    } });

    const result = await executeCase(executionInput(preferenceCase(), runtime, {
      recommendations: { recommendation: 'recommendation:1' },
    }));

    expect(result.businessIds).toMatchObject({
      recommendationId: 'recommendation:1', feedbackChangeId: 'feedback-change:1',
      preferenceLearningBatchId: 'preference-batch:1',
    });
    expect(result.ownerFacts).toMatchObject({ status: 'failed' });
  });
});

function testRuntime(overrides: {
  readonly session?: Partial<TestRuntime['host']['session']>;
  readonly discovery?: Partial<TestRuntime['host']['discovery']>;
  readonly observability?: Partial<TestRuntime['host']['observability']>;
}): TestRuntime {
  return {
    host: {
      session: {
        sendUserInput: unexpected,
        readCommittedRun: unexpected,
        ...overrides.session,
      },
      discovery: {
        getInterestFacts: unexpected,
        requestCandidateSupply: unexpected,
        waitCandidateSupplyCheck: unexpected,
        getCandidateSupplyFacts: unexpected,
        ensureDaily: unexpected,
        waitDailyBatch: unexpected,
        getDailyRecommendationFacts: unexpected,
        updateRecommendationState: unexpected,
        waitPreferenceLearning: unexpected,
        getPreferenceLearningFacts: unexpected,
        ...overrides.discovery,
      },
      observability: {
        flush: unexpected,
        listTraces: unexpected,
        getTrace: unexpected,
        getContent: unexpected,
        ...overrides.observability,
      },
    },
  };
}

function interestObservability(outcome: {
  readonly outcome: 'evidence_committed' | 'no_durable_evidence';
  readonly changedInterestIds: readonly string[];
  readonly evidenceIds: readonly string[];
}): TestRuntime['host']['observability'] {
  const traceId = '11111111-1111-4111-8111-111111111111';
  const correlation = { executionId: 'execution:interest', sessionId: 'session:source' };
  const summary = {
    traceId, traceKind: 'interest_understanding' as const, status: 'ok' as const,
    diagnostics: 'complete' as const, correlation, startedAt: now, endedAt: now,
    durationMs: 0, spanCount: 0, eventCount: 0, contentCount: 1, issueCount: 0,
  };
  return {
    async flush() {},
    async listTraces() { return { status: 'ok', traces: [summary] }; },
    async getTrace() {
      return {
        status: 'found',
        trace: {
          summary,
          outcome: { status: 'ok', code: outcome.outcome },
          spans: [],
          contents: [{
            sequence: 1, timestamp: now, kind: 'interest.understanding.outcome',
            mode: 'inline', contentId: 'a'.repeat(64), mediaType: 'application/json',
            byteLength: 1, correlation,
          }],
          links: [], issues: [], sourceFiles: [],
        },
      };
    },
    async getContent() {
      const json = JSON.stringify(outcome);
      return {
        status: 'available',
        content: {
          encoding: 'json', contentId: 'a'.repeat(64), mediaType: 'application/json',
          byteLength: new TextEncoder().encode(json).byteLength, json,
        },
      };
    },
  };
}

async function unexpected(): Promise<never> {
  throw new Error('Unexpected Product Host operation.');
}

function agentRun(executionId: string, sessionId: string): Awaited<ReturnType<TestRuntime['host']['session']['sendUserInput']>> {
  return {
    payload: {
      type: 'agent_run', requestId: `request:${executionId}`, userMessageId: `user:${executionId}`,
      session: { id: sessionId, projectId: 'workspace:1', title: 'Evaluation', status: 'active', createdAt: now, updatedAt: now },
      userMessage: {
        messageId: `user:${executionId}`, sessionId, executionId, createdAt: now,
        kind: 'user', displayContent: [{ type: 'text', text: 'input' }], attachments: [],
      },
      run: { executionId, sessionId, status: 'running', createdAt: now },
    },
  };
}

function committedReply(executionId: string): Awaited<ReturnType<TestRuntime['host']['session']['readCommittedRun']>> {
  return {
    status: 'ok', workspaceChanges: [], diagnostics: [],
    messages: [{
      type: 'message', entryId: `entry:${executionId}`,
      message: {
        messageId: `assistant:${executionId}`, sessionId: 'session:1', executionId,
        kind: 'assistantReply', status: 'completed', content: [{ type: 'text', text: 'done' }],
        createdAt: now, completedAt: now,
      },
    }],
  };
}

function executionInput(
  evaluationCase: EvaluationCase,
  runtime: TestRuntime,
  ids: Partial<Parameters<typeof executeCase>[0]['initialStateIds']> = {},
): Parameters<typeof executeCase>[0] {
  return {
    evaluationCase, runtime,
    initialStateIds: {
      workspaceId: 'workspace:1', sessions: {}, interests: {}, candidates: {}, recommendations: {},
      preferenceRevisions: [], ...ids,
    },
    candidateModel: { providerId: 'test', modelId: 'model' },
    now: () => now,
    safetyWallClockLimitMs: 1_000,
  };
}

function baseCase(type: EvaluationCase['type']): Record<string, unknown> {
  return { schemaVersion: 2, caseId: `case.${type}`, revision: 1, name: type, description: `Run ${type}.`, type };
}

function conversationCase(): EvaluationCase {
  return EvaluationCaseSchema.parse({
    ...baseCase('conversation'),
    initialState: { clock: now, workspaceFiles: [], sessionHistory: [], controlledWeb: [], approvalDecisions: [] },
    input: { steps: [{ userInput: 'first' }, { userInput: 'second' }] },
  });
}

function interestCase(): EvaluationCase {
  return EvaluationCaseSchema.parse({
    ...baseCase('interest_understanding'),
    initialState: { clock: now, sourceSession: { referenceId: 'source', title: 'Source', turns: [] }, existingInterests: [] },
    input: { text: 'I like TypeScript.' },
  });
}

function candidateCase(): EvaluationCase {
  return EvaluationCaseSchema.parse({
    ...baseCase('candidate_supply'),
    initialState: {
      clock: now, targetCount: 1,
      interests: [{ referenceId: 'interest', description: 'TypeScript' }], existingCandidates: [],
      controlledSources: [{ sourceId: 'open_web', queryIncludes: 'TypeScript', results: [] }],
    },
    input: { trigger: 'evaluation' },
  });
}

function dailyCase(): EvaluationCase {
  return EvaluationCaseSchema.parse({
    ...baseCase('daily_recommendation'),
    initialState: {
      clock: now, dailyTargetCount: 1, interests: [{ referenceId: 'interest', description: 'TypeScript' }],
      candidates: [candidate()], previousRecommendations: [], preferences: [],
    },
    input: { trigger: 'manual' },
  });
}

function preferenceCase(): EvaluationCase {
  return EvaluationCaseSchema.parse({
    ...baseCase('preference_learning'),
    initialState: {
      clock: now, interests: [{ referenceId: 'interest', description: 'TypeScript' }],
      candidates: [candidate()],
      recommendations: [{ referenceId: 'recommendation', candidateReferenceId: 'candidate', reason: 'Relevant' }],
      existingFeedback: [], preferences: [],
    },
    input: { recommendationReferenceId: 'recommendation', reaction: 'liked' },
  });
}

function candidate() {
  return {
    referenceId: 'candidate', sourceId: 'open_web', sourceName: 'Open Web',
    canonicalUrl: 'https://example.test/item', title: 'Item', matchedInterestReferenceIds: ['interest'],
    relevance: 'direct',
  };
}

function recommendationView() {
  return {
    recommendationId: 'recommendation:1', batchId: 'batch:1', localDate: '2026-01-15', position: 0,
    sourceId: 'open_web' as const, sourceName: 'Open Web', canonicalUrl: 'https://example.test/item',
    contentType: 'article' as const, title: 'Item', recommendationReason: 'Relevant',
    hidden: false, favorite: false, watchLater: false, publishedAt: now,
  };
}
