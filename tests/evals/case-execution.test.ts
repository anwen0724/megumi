/* Verifies that each Case driver uses the matching real Product Host contract and preserves Owner facts. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema, type EvaluationCase } from '../../evals/agent/contracts/evaluation-dataset';
import { executeCase } from '../../evals/agent/run/case-execution';

const now = '2026-01-15T08:00:00.000Z';
type TestRuntime = Parameters<typeof executeCase>[0]['runtime'];

describe('Case execution', () => {
  it('treats a committed cancellation as terminal and does not execute the next step', async () => {
    let calls = 0;
    const runtime = testRuntime({ session: {
      async sendUserInput() { calls += 1; return agentRun('cancelled', 'session:1'); },
      async readCommittedRun() {
        const reply = committedReply('cancelled');
        return { ...reply, messages: reply.messages.map((entry) => entry.type === 'message' && entry.message.kind === 'assistantReply'
          ? { ...entry, message: { ...entry.message, status: 'cancelled' as const } } : entry) };
      },
    } });
    const result = await executeCase({ ...executionInput(conversationCase(), runtime), safetyWallClockLimitMs: 60 });
    expect(result.terminalState).toBe('settled');
    expect(calls).toBe(1);
  });
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

  it('waits for Candidate Supply and reads the final Candidate Pool from its Owner', async () => {
    const runtime = testRuntime({ discovery: {
      async requestCandidateSupply() {
        return {
          requestId: 'request:supply',
          trigger: 'supply_conditions_changed',
          requestedAt: now,
          completedAt: now,
          addedCandidateCount: 1,
          addedInterestMatchCount: 1,
          status: 'fulfilled',
          executionId: 'execution:supply',
          availableCount: 2,
          remainingReplenishmentCount: 0,
        };
      },
      async getCandidatePool() {
        return { availableCount: 2, targetCount: 2 };
      },
    } });

    const result = await executeCase(executionInput(candidateCase(), runtime));

    expect(result.businessIds).toEqual({ requestId: 'request:supply', executionId: 'execution:supply' });
    expect(result.ownerFacts).toEqual({ availableCount: 2, targetCount: 2 });
    expect(result.traceTargets).toEqual([{
      traceKind: 'candidate_supply',
      correlation: { requestId: 'request:supply' },
      expectation: 'required',
    }]);
  });

  it('associates Recommendation attempts by request ID and reads final database facts', async () => {
    const collection = recommendationCollection();
    const runtime = testRuntime({ discovery: {
      async requestRecommendation() {
        return {
          status: 'started', localDate: '2026-01-15', requestId: 'request:1',
          executionId: 'execution:first',
        };
      },
      async waitRecommendation() {
        return { status: 'published', collection };
      },
      async getRecommendationCollection() {
        return collection;
      },
    } });

    const result = await executeCase(executionInput(recommendationCase(), runtime));

    expect(result.businessIds).toEqual({
      requestId: 'request:1',
      executionIds: ['execution:first'],
      recommendationIds: ['recommendation:1'],
    });
    expect(result.ownerFacts).toEqual(collection);
    expect(result.traceTargets).toEqual([{
      traceKind: 'recommendation', correlation: { requestId: 'request:1' },
      expectation: 'required',
    }]);
  });

  it('submits Reaction, waits for Preference Learning, and preserves final Owner facts', async () => {
    const runtime = testRuntime({ discovery: {
      async updateRecommendationState() {
        return {
          status: 'updated' as const,
          state: recommendationState({ reaction: 'liked', reactionRevision: 1, reactionChangedAt: now }),
        };
      },
      async getPreferenceLearning() {
        return {
          recommendationId: 'recommendation:1', status: 'learned',
          currentReactionRevision: 1, learnedReactionRevision: 1, changedAt: now, preferences: [],
        };
      },
    } });

    const result = await executeCase(executionInput(preferenceCase(), runtime, {
      recommendations: { recommendation: 'recommendation:1' },
    }));

    expect(result.businessIds).toMatchObject({
      recommendationId: 'recommendation:1',
      preferenceSetIds: [],
    });
    expect(result.ownerFacts).toMatchObject({ status: 'learned', currentReactionRevision: 1, learnedReactionRevision: 1 });
    expect(result.traceTargets).toEqual([{ traceKind: 'preference_learning', correlation: { recommendationIds: ['recommendation:1'] }, expectation: 'required' }]);
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
        getCandidatePool: unexpected,
        requestRecommendation: unexpected,
        waitRecommendation: unexpected,
        getRecommendationCollection: unexpected,
        updateRecommendationState: unexpected,
        waitPreferenceLearning: unexpected,
        getPreferenceLearning: unexpected,
        getPreferenceLearningStatus: unexpected,
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
      clock: now, minimumCount: 1, maximumCount: 3,
      interests: [{ referenceId: 'interest', description: 'TypeScript' }], existingCandidates: [],
      controlledSources: [{ sourceId: 'open_web', queryIncludes: 'TypeScript', results: [] }],
    },
    input: { trigger: 'supply_conditions_changed' },
  });
}

function recommendationCase(): EvaluationCase {
  return EvaluationCaseSchema.parse({
    ...baseCase('recommendation'),
    initialState: {
      clock: now, recommendationTargetCount: 1, recommendationWorkingSetCount: 2,
      interests: [{ referenceId: 'interest', description: 'TypeScript' }],
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
      existingReactions: [], preferences: [],
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

function recommendationCollection() {
  return {
    localDate: '2026-01-15',
    publishedAt: now,
    items: [{
      id: 'recommendation:1', candidateId: 'candidate:1', contentIdentity: 'url:https://example.test/item',
      localDate: '2026-01-15', position: 0, recommendationReason: 'Relevant',
      selectionBasis: {
        primaryInterestId: 'interest:1', matchedInterestIds: ['interest:1'],
        interestRevisions: [{ interestId: 'interest:1', revision: 0 }], preferenceRevisions: [],
      },
      publishedAt: now,
      content: {
        id: 'content:1', recommendationId: 'recommendation:1', sourceId: 'open_web' as const,
        sourceName: 'Open Web', canonicalUrl: 'https://example.test/item', contentType: 'article' as const,
        title: 'Item', contentSummary: 'Item summary', contentTruncated: false,
      },
      state: recommendationState(),
    }],
  };
}

function recommendationState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'state:1', recommendationId: 'recommendation:1', reactionRevision: 0,
    learnedReactionRevision: 0, updatedAt: now, ...overrides,
  };
}
