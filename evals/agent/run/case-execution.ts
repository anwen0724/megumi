/*
 * Sends one Evaluation Case through the existing ProductRuntime Host and preserves
 * the owning product operation's returned result without inventing a shared status.
 */
import type { ProductRuntime } from '@megumi/composition';
import { z } from 'zod';
import type { EvaluationCase } from '../contracts/evaluation-dataset';
import type { InstalledInitialStateIds } from './initial-state';

export interface EvaluationSafetyInterruption {
  readonly source: 'evaluation_safety_guard';
  readonly limitMs: number;
}

export interface CaseTraceTarget {
  readonly traceKind: EvaluationCase['type'];
  readonly correlation: Readonly<Record<string, string | string[]>>;
  readonly expectation: 'required';
}

export interface CaseExecutionResult {
  readonly caseType: EvaluationCase['type'];
  readonly terminalState: 'settled' | 'pending' | 'interrupted';
  readonly productResult: unknown;
  readonly ownerFacts: unknown;
  readonly businessIds: Readonly<Record<string, string | string[]>>;
  readonly traceTargets: readonly CaseTraceTarget[];
  readonly interruption?: EvaluationSafetyInterruption;
}

type CaseExecutionProgress = Pick<CaseExecutionResult, 'productResult' | 'ownerFacts' | 'businessIds' | 'traceTargets'>;

/** Retains already returned business facts if a later driver query fails. */
export class CaseExecutionFailure extends Error {
  readonly partial: CaseExecutionProgress;

  constructor(cause: unknown, partial: CaseExecutionProgress) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'CaseExecutionFailure';
    this.partial = structuredClone(partial);
  }
}

interface CaseExecutionInput {
  readonly evaluationCase: EvaluationCase;
  readonly runtime: CaseExecutionRuntime;
  readonly initialStateIds: InstalledInitialStateIds;
  readonly candidateModel: { readonly providerId: string; readonly modelId: string };
  readonly now: () => string;
  readonly advanceTime?: (durationMs: number, deadlineMs: number) => Promise<void>;
  readonly safetyWallClockLimitMs: number;
  readonly safetyDeadlineMs: number;
  readonly progress: { current: CaseExecutionProgress };
}

type CaseExecutionRuntime = {
  readonly host: {
    readonly session: Pick<ProductRuntime['host']['session'], 'sendUserInput' | 'readCommittedRun'>;
    readonly discovery: Pick<ProductRuntime['host']['discovery'],
      | 'getInterestFacts'
      | 'requestCandidateSupply'
      | 'getCandidatePool'
      | 'requestRecommendation'
      | 'waitRecommendation'
      | 'getRecommendationCollection'
      | 'updateRecommendationState'
      | 'waitPreferenceLearning'
      | 'getPreferenceLearning'
      | 'getPreferenceLearningStatus'>;
    readonly observability: Pick<ProductRuntime['host']['observability'],
      'flush' | 'listTraces' | 'getTrace' | 'getContent'>;
  };
};

/** Calls the same public Product Host operation used by a normal Host. */
export async function executeCase(input: Omit<CaseExecutionInput, 'safetyDeadlineMs' | 'progress'>): Promise<CaseExecutionResult> {
  const executionInput: CaseExecutionInput = {
    ...input,
    safetyDeadlineMs: Date.now() + input.safetyWallClockLimitMs,
    progress: { current: { productResult: {}, ownerFacts: {}, businessIds: {}, traceTargets: [] } },
  };
  const drivers = {
    conversation: executeConversation,
    interest_understanding: executeInterestUnderstanding,
    candidate_supply: executeCandidateSupply,
    recommendation: executeRecommendation,
    preference_learning: executePreferenceLearning,
  };
  let result;
  try {
    result = await waitForProductResult(drivers[executionInput.evaluationCase.type](executionInput), executionInput.safetyDeadlineMs);
  } catch (error) {
    throw new CaseExecutionFailure(error, executionInput.progress.current);
  }
  return result.status === 'completed' ? result.value : {
    ...structuredClone(executionInput.progress.current),
    caseType: input.evaluationCase.type, terminalState: 'interrupted', interruption: safetyInterruption(executionInput),
  };
}

async function executeConversation(input: CaseExecutionInput): Promise<CaseExecutionResult> {
  if (input.evaluationCase.type !== 'conversation') throw new Error('Conversation Case is required.');
  let sessionId = Object.values(input.initialStateIds.sessions)[0];
  const executionIds: string[] = [];
  const steps: unknown[] = [];
  const traceTargets: CaseTraceTarget[] = [];
  for (const step of input.evaluationCase.input.steps) {
    if (Date.now() >= input.safetyDeadlineMs) return {
      ...structuredClone(input.progress.current), caseType: 'conversation', terminalState: 'interrupted', interruption: safetyInterruption(input),
    };
    const accepted = await input.runtime.host.session.sendUserInput({
      ...(sessionId ? { sessionId } : {}),
      projectId: input.initialStateIds.workspaceId,
      text: step.userInput,
      modelSelection: {
        provider_id: input.candidateModel.providerId,
        model_id: input.candidateModel.modelId,
      },
      permissionMode: step.permissionMode,
      createdAt: input.now(),
    });
    if (accepted.payload.type !== 'agent_run') {
      return execution({
        caseType: 'conversation', terminalState: 'settled',
        productResult: { steps, acceptance: accepted },
        ownerFacts: { committedSteps: steps },
        businessIds: sessionId ? { sessionId, executionIds } : { executionIds },
        traceTargets,
      });
    }
    sessionId = accepted.payload.session.id;
    executionIds.push(accepted.payload.run.executionId);
    traceTargets.push(conversationTraceTarget({
      executionId: accepted.payload.run.executionId,
      sessionId,
      messageId: accepted.payload.userMessageId,
    }));
    input.progress.current = { productResult: { steps, acceptance: accepted }, ownerFacts: { committedSteps: steps }, businessIds: { sessionId, executionIds }, traceTargets };
    const settled = await waitForCommittedConversation({
      runtime: input.runtime,
      sessionId,
      executionId: accepted.payload.run.executionId,
      deadlineMs: input.safetyDeadlineMs,
    });
    steps.push(settled.result);
    if (settled.status === 'interrupted') {
      return execution({
        caseType: 'conversation', terminalState: 'interrupted',
        productResult: { steps, sessionId },
        ownerFacts: { committedSteps: steps },
        businessIds: { sessionId, executionIds },
        traceTargets,
        interruption: safetyInterruption(input),
      });
    }
    if (settled.status === 'failed' || settled.status === 'cancelled') break;
  }
  return execution({
    caseType: 'conversation', terminalState: 'settled',
    productResult: { steps, sessionId },
    ownerFacts: { committedSteps: steps },
    businessIds: { ...(sessionId ? { sessionId } : {}), executionIds },
    traceTargets,
  });
}

async function executeInterestUnderstanding(input: CaseExecutionInput): Promise<CaseExecutionResult> {
  if (input.evaluationCase.type !== 'interest_understanding') throw new Error('Interest Understanding Case is required.');
  const sessionId = Object.values(input.initialStateIds.sessions)[0];
  if (!sessionId) throw new Error('Interest Understanding requires one initial Session.');
  const accepted = await input.runtime.host.session.sendUserInput({
    sessionId,
    projectId: input.initialStateIds.workspaceId,
    text: input.evaluationCase.input.text,
    modelSelection: {
      provider_id: input.candidateModel.providerId,
      model_id: input.candidateModel.modelId,
    },
    permissionMode: 'auto',
    createdAt: input.now(),
  });
  if (accepted.payload.type !== 'agent_run') {
    return execution({
      caseType: 'interest_understanding', terminalState: 'settled',
      productResult: { sourceConversation: { acceptance: accepted } },
      ownerFacts: {},
      businessIds: { sessionId },
      traceTargets: [],
    });
  }
  const executionId = accepted.payload.run.executionId;
  const traceTargets: CaseTraceTarget[] = [conversationTraceTarget({
    executionId,
    sessionId,
    messageId: accepted.payload.userMessageId,
  })];
  input.progress.current = { productResult: { acceptance: accepted }, ownerFacts: {}, businessIds: { sessionId, executionId }, traceTargets };
  const conversation = await waitForCommittedConversation({
    runtime: input.runtime,
    sessionId,
    executionId,
    deadlineMs: input.safetyDeadlineMs,
  });
  if (conversation.status !== 'completed') {
    return execution({
      caseType: 'interest_understanding',
      terminalState: conversation.status === 'interrupted' ? 'interrupted' : 'settled',
      productResult: { sourceConversation: conversation.result },
      ownerFacts: {},
      businessIds: { sessionId, executionId },
      traceTargets,
      ...(conversation.status === 'interrupted' ? { interruption: safetyInterruption(input) } : {}),
    });
  }
  const understanding = await waitForInterestUnderstandingTrace({
    runtime: input.runtime,
    executionId,
    deadlineMs: input.safetyDeadlineMs,
  });
  if (understanding.status === 'interrupted') {
    return execution({
      caseType: 'interest_understanding', terminalState: 'interrupted',
      productResult: { sourceConversation: conversation.result },
      ownerFacts: {},
      businessIds: { sessionId, executionId },
      traceTargets,
      interruption: safetyInterruption(input),
    });
  }
  traceTargets.push({
    traceKind: 'interest_understanding',
    correlation: { executionId, sessionId },
    expectation: 'required',
  });
  const outcome = understanding.value.outcome;
  input.progress.current = { ...input.progress.current, productResult: { sourceConversation: conversation.result, understandingTrace: understanding.value.trace, ...(outcome ? { outcome } : {}) } };
  const ownerFacts = outcome
    ? await input.runtime.host.discovery.getInterestFacts({
        interestIds: outcome.changedInterestIds,
        evidenceIds: outcome.evidenceIds,
      })
    : { interests: [], evidence: [] };
  return execution({
    caseType: 'interest_understanding', terminalState: 'settled',
    productResult: {
      sourceConversation: conversation.result,
      understandingTrace: understanding.value.trace,
      ...(outcome ? { outcome } : {}),
    },
    ownerFacts,
    businessIds: {
      sessionId,
      executionId,
      ...(outcome ? {
        interestIds: outcome.changedInterestIds,
        evidenceIds: outcome.evidenceIds,
      } : {}),
    },
    traceTargets,
  });
}

async function executeCandidateSupply(input: CaseExecutionInput): Promise<CaseExecutionResult> {
  if (input.evaluationCase.type !== 'candidate_supply') throw new Error('Candidate Supply Case is required.');
  const completion = await waitForProductResult(
    input.runtime.host.discovery.requestCandidateSupply({
      trigger: input.evaluationCase.input.trigger,
    }),
    input.safetyDeadlineMs,
  );
  if (completion.status === 'interrupted') {
    return execution({
      caseType: 'candidate_supply', terminalState: 'interrupted',
      productResult: {},
      ownerFacts: {},
      businessIds: {},
      traceTargets: [],
      interruption: safetyInterruption(input),
    });
  }
  const result = completion.value;
  const executionId = 'executionId' in result ? result.executionId : undefined;
  input.progress.current = { productResult: result, ownerFacts: {},
    businessIds: { requestId: result.requestId, ...(executionId ? { executionId } : {}) },
    traceTargets: [{ traceKind: 'candidate_supply', correlation: { requestId: result.requestId }, expectation: 'required' }],
  };
  const pool = await input.runtime.host.discovery.getCandidatePool();
  return execution({
    caseType: 'candidate_supply', terminalState: 'settled',
    productResult: result,
    ownerFacts: pool ?? {},
    businessIds: {
      requestId: result.requestId,
      ...(executionId ? { executionId } : {}),
    },
    traceTargets: [{
      traceKind: 'candidate_supply',
      correlation: { requestId: result.requestId },
      expectation: 'required',
    }],
  });
}

async function executeRecommendation(input: CaseExecutionInput): Promise<CaseExecutionResult> {
  if (input.evaluationCase.type !== 'recommendation') throw new Error('Recommendation Case is required.');
  const accepted = await input.runtime.host.discovery.requestRecommendation({
    trigger: input.evaluationCase.input.trigger,
  });
  if (accepted.status !== 'started' && accepted.status !== 'in_progress') {
    return execution({
      caseType: 'recommendation', terminalState: accepted.status === 'waiting_for_candidates' ? 'pending' : 'settled',
      productResult: { accepted },
      ownerFacts: accepted.status === 'already_published' ? accepted.collection : {},
      businessIds: accepted.status === 'already_published'
        ? { recommendationIds: accepted.collection.items.map(({ id }) => id) }
        : {},
      traceTargets: [],
    });
  }
  input.progress.current = { productResult: { accepted }, ownerFacts: {},
    businessIds: { requestId: accepted.requestId, executionIds: [accepted.executionId] }, traceTargets: recommendationTraceTargets(accepted.requestId),
  };
  let completion;
  do {
    completion = await waitForProductResult(input.runtime.host.discovery.waitRecommendation({
      requestId: accepted.requestId,
      timeoutMs: Math.min(300_000, Math.max(1, input.safetyDeadlineMs - Date.now())),
    }),
      input.safetyDeadlineMs,
    );
    if (completion.status === 'completed' && completion.value.status === 'timed_out') await waitForNextPoll(input.safetyDeadlineMs);
  } while (completion.status === 'completed' && completion.value.status === 'timed_out' && Date.now() < input.safetyDeadlineMs);
  const traceTargets = recommendationTraceTargets(accepted.requestId);
  const baseBusinessIds = {
    requestId: accepted.requestId,
    executionIds: [accepted.executionId],
  };
  if (completion.status === 'interrupted' || completion.value.status === 'timed_out') {
    return execution({
      caseType: 'recommendation', terminalState: 'interrupted',
      productResult: { accepted },
      ownerFacts: {},
      businessIds: baseBusinessIds,
      traceTargets,
      interruption: safetyInterruption(input),
    });
  }
  input.progress.current = { ...input.progress.current, productResult: { accepted, completion: completion.value } };
  const facts = completion.value.status === 'published'
    ? await input.runtime.host.discovery.getRecommendationCollection({
        localDate: accepted.localDate,
        includeHidden: true,
      })
    : null;
  const recommendationIds = completion.value.status === 'published'
    ? completion.value.collection.items.map(({ id }) => id)
    : [];
  return execution({
    caseType: 'recommendation', terminalState: 'settled',
    productResult: { accepted, completion: completion.value },
    ownerFacts: facts,
    businessIds: {
      ...baseBusinessIds,
      recommendationIds,
    },
    traceTargets,
  });
}

async function executePreferenceLearning(input: CaseExecutionInput): Promise<CaseExecutionResult> {
  if (input.evaluationCase.type !== 'preference_learning') throw new Error('Preference Learning Case is required.');
  const recommendationId = input.initialStateIds.recommendations[input.evaluationCase.input.recommendationReferenceId];
  if (!recommendationId) {
    throw new Error(`Initial Recommendation was not installed: ${input.evaluationCase.input.recommendationReferenceId}.`);
  }
  const updated = await input.runtime.host.discovery.updateRecommendationState({
    recommendationId,
    action: 'set_reaction',
    reaction: input.evaluationCase.input.reaction === 'none' ? null : input.evaluationCase.input.reaction,
  });
  if (updated.status === 'not_found') {
    return execution({
      caseType: 'preference_learning', terminalState: 'settled',
      productResult: { updated },
      ownerFacts: {},
      businessIds: { recommendationId },
      traceTargets: [],
    });
  }
  const traceTargets: CaseTraceTarget[] = [];
  const finish = (terminalState: CaseExecutionResult['terminalState'], completion: unknown, ownerFacts: unknown, preferenceSetIds: string[] = []): CaseExecutionResult => execution({
    caseType: 'preference_learning', terminalState, productResult: { updated, completion }, ownerFacts,
    businessIds: { recommendationId, preferenceSetIds }, traceTargets,
    ...(terminalState === 'interrupted' ? { interruption: safetyInterruption(input) } : {}),
  });
  input.progress.current = { productResult: { updated }, ownerFacts: {}, businessIds: { recommendationId }, traceTargets };
  const advanceMs = input.evaluationCase.input.advanceTimeMs;
  if (advanceMs !== undefined) {
    if (!input.advanceTime) throw new Error('This environment does not support controlled time advance.');
    try {
      await input.advanceTime(advanceMs, input.safetyDeadlineMs);
    } catch (error) {
      if (Date.now() >= input.safetyDeadlineMs) return finish('interrupted', { status: 'safety_interrupted' }, {});
      throw error;
    }
  }
  while (Date.now() <= input.safetyDeadlineMs) {
    const facts = await input.runtime.host.discovery.getPreferenceLearning({ recommendationId });
    if (facts?.status === 'learned') {
      if (updated.status === 'updated') traceTargets.push({ traceKind: 'preference_learning', correlation: { recommendationIds: [recommendationId] }, expectation: 'required' });
      return finish('settled', facts, facts, facts.preferences.map(({ preferenceSet }) => preferenceSet.id));
    }
    const status = await input.runtime.host.discovery.getPreferenceLearningStatus({ recommendationId });
    if (status.status === 'failed' && !status.retryAt) {
      traceTargets.push({ traceKind: 'preference_learning', correlation: { recommendationIds: [recommendationId] }, expectation: 'required' });
      return finish('settled', status, facts);
    }
    // A frozen Controlled clock cannot reach an undeclared future timer. Preserve pending honestly.
    if (input.advanceTime && status.status !== 'running') return finish('pending', status, facts);
    await waitForNextPoll(input.safetyDeadlineMs);
  }
  return finish('interrupted', { status: 'safety_interrupted' }, await input.runtime.host.discovery.getPreferenceLearning({ recommendationId }));
}

type CommittedRunResult = Awaited<ReturnType<ProductRuntime['host']['session']['readCommittedRun']>>;
type ConversationSettlement =
  | { readonly status: 'completed' | 'failed' | 'cancelled'; readonly result: CommittedRunResult }
  | { readonly status: 'interrupted'; readonly result: Readonly<Record<string, string>> };

async function waitForCommittedConversation(input: {
  readonly runtime: CaseExecutionRuntime;
  readonly sessionId: string;
  readonly executionId: string;
  readonly deadlineMs: number;
}): Promise<ConversationSettlement> {
  while (Date.now() <= input.deadlineMs) {
    const result = await input.runtime.host.session.readCommittedRun({
      sessionId: input.sessionId,
      executionId: input.executionId,
    });
    if (result.status === 'failed') return { status: 'failed', result };
    if (result.status === 'ok') {
      const reply = result.messages.find((entry) => (
        entry.type === 'message' && entry.message.kind === 'assistantReply'
      ));
      if (reply?.type === 'message' && reply.message.kind === 'assistantReply') {
        if (reply.message.status === 'completed') return { status: 'completed', result };
        if (reply.message.status === 'failed') return { status: 'failed', result };
        if (reply.message.status === 'cancelled') return { status: 'cancelled', result };
      }
    }
    await waitForNextPoll(input.deadlineMs);
  }
  return {
    status: 'interrupted',
    result: { sessionId: input.sessionId, executionId: input.executionId },
  };
}

type ProductWaitResult<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'interrupted' };

async function waitForProductResult<T>(
  result: Promise<T>,
  deadlineMs: number,
): Promise<ProductWaitResult<T>> {
  const timeoutMs = Math.max(0, deadlineMs - Date.now());
  if (timeoutMs === 0) return { status: 'interrupted' };
  return new Promise<ProductWaitResult<T>>((resolve, reject) => {
    let completed = false;
    const timer = setTimeout(() => {
      completed = true;
      resolve({ status: 'interrupted' });
    }, timeoutMs);
    void result.then(
      (value) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve({ status: 'completed', value });
      },
      (error: unknown) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const InterestUnderstandingOutcomeSchema = z.object({
  outcome: z.enum(['evidence_committed', 'no_durable_evidence']),
  changedInterestIds: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().min(1)),
}).strict();
type InterestTraceDetail = Extract<
  Awaited<ReturnType<CaseExecutionRuntime['host']['observability']['getTrace']>>,
  { readonly status: 'found' }
>['trace'];

async function waitForInterestUnderstandingTrace(input: {
  readonly runtime: CaseExecutionRuntime;
  readonly executionId: string;
  readonly deadlineMs: number;
}): Promise<ProductWaitResult<{
  readonly trace: InterestTraceDetail;
  readonly outcome?: z.infer<typeof InterestUnderstandingOutcomeSchema>;
}>> {
  while (Date.now() <= input.deadlineMs) {
    await input.runtime.host.observability.flush();
    const listed = await input.runtime.host.observability.listTraces({
      traceKind: 'interest_understanding',
      correlation: { executionId: input.executionId },
      limit: 5,
    });
    if (listed.status === 'failed') throw new Error(listed.message);
    const settled = listed.traces.find((trace) => trace.status !== 'incomplete');
    if (settled) {
      const detail = await input.runtime.host.observability.getTrace({ traceId: settled.traceId });
      if (detail.status === 'failed') throw new Error(detail.message);
      if (detail.status === 'found') {
        const outcomeCheckpoint = [...detail.trace.contents].reverse().find(
          (content) => content.kind === 'interest.understanding.outcome',
        );
        const outcome = outcomeCheckpoint
          ? await readInterestUnderstandingOutcome(input.runtime, settled.traceId, outcomeCheckpoint.sequence)
          : undefined;
        if (settled.status === 'ok' && !outcome) {
          throw new Error('Completed Interest Understanding Trace has no terminal outcome content.');
        }
        return {
          status: 'completed',
          value: { trace: detail.trace, ...(outcome ? { outcome } : {}) },
        };
      }
    }
    await waitForNextPoll(input.deadlineMs);
  }
  return { status: 'interrupted' };
}

async function readInterestUnderstandingOutcome(
  runtime: CaseExecutionRuntime,
  traceId: string,
  sequence: number,
): Promise<z.infer<typeof InterestUnderstandingOutcomeSchema> | undefined> {
  const result = await runtime.host.observability.getContent({ traceId, sequence });
  if (result.status === 'failed') throw new Error(result.message);
  if (result.status !== 'available' || result.content.encoding === 'binary') return undefined;
  const serialized = result.content.encoding === 'json' ? result.content.json : result.content.text;
  return InterestUnderstandingOutcomeSchema.parse(JSON.parse(serialized));
}

function execution(value: CaseExecutionResult): CaseExecutionResult {
  return value;
}

function safetyInterruption(input: CaseExecutionInput): EvaluationSafetyInterruption {
  return { source: 'evaluation_safety_guard', limitMs: input.safetyWallClockLimitMs };
}

function conversationTraceTarget(correlation: {
  readonly executionId: string;
  readonly sessionId: string;
  readonly messageId: string;
}): CaseTraceTarget {
  return { traceKind: 'conversation', correlation, expectation: 'required' };
}

function recommendationTraceTargets(requestId: string): CaseTraceTarget[] {
  return [{
    traceKind: 'recommendation',
    correlation: { requestId },
    expectation: 'required',
  }];
}

async function waitForNextPoll(deadlineMs: number): Promise<void> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
}
