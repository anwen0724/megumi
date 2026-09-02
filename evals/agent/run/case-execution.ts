/*
 * Sends one Evaluation Case through the existing ProductRuntime Host and preserves
 * the owning product operation's returned result without inventing a shared status.
 */
import type { ProductRuntime } from '@megumi/composition';
import type { EvaluationCase } from '../contracts/evaluation-dataset';
import type { InstalledInitialStateIds } from './initial-state';

export interface EvaluationSafetyInterruption {
  readonly source: 'evaluation_safety_guard';
  readonly limitMs: number;
}

export interface CaseTraceTarget {
  readonly traceKind: EvaluationCase['type'];
  readonly correlation: Readonly<Record<string, string>>;
  readonly expectation: 'required';
}

export interface CaseExecutionResult {
  readonly caseType: EvaluationCase['type'];
  readonly terminalState: 'settled' | 'interrupted';
  readonly productResult: unknown;
  readonly ownerFacts: unknown;
  readonly businessIds: Readonly<Record<string, string | string[]>>;
  readonly traceTargets: readonly CaseTraceTarget[];
  readonly interruption?: EvaluationSafetyInterruption;
}

interface CaseExecutionInput {
  readonly evaluationCase: EvaluationCase;
  readonly runtime: CaseExecutionRuntime;
  readonly initialStateIds: InstalledInitialStateIds;
  readonly candidateModel: { readonly providerId: string; readonly modelId: string };
  readonly now: () => string;
  readonly safetyWallClockLimitMs: number;
  readonly safetyDeadlineMs: number;
}

type CaseExecutionRuntime = {
  readonly host: {
    readonly session: Pick<ProductRuntime['host']['session'], 'sendUserInput' | 'readCommittedRun'>;
    readonly discovery: Pick<ProductRuntime['host']['discovery'],
      | 'waitInterestUnderstanding'
      | 'requestCandidateSupply'
      | 'waitCandidateSupplyCheck'
      | 'getCandidateSupplyFacts'
      | 'ensureDaily'
      | 'waitDailyBatch'
      | 'getDailyRecommendationFacts'
      | 'updateRecommendationState'
      | 'waitPreferenceLearning'
      | 'getPreferenceLearningFacts'>;
  };
};

/** Calls the same public Product Host operation used by a normal Host. */
export async function executeCase(input: Omit<CaseExecutionInput, 'safetyDeadlineMs'>): Promise<CaseExecutionResult> {
  const executionInput: CaseExecutionInput = {
    ...input,
    safetyDeadlineMs: Date.now() + input.safetyWallClockLimitMs,
  };
  switch (executionInput.evaluationCase.type) {
    case 'conversation': return executeConversation(executionInput);
    case 'interest_understanding': return executeInterestUnderstanding(executionInput);
    case 'candidate_supply': return executeCandidateSupply(executionInput);
    case 'daily_recommendation': return executeDailyRecommendation(executionInput);
    case 'preference_learning': return executePreferenceLearning(executionInput);
  }
}

async function executeConversation(input: CaseExecutionInput): Promise<CaseExecutionResult> {
  if (input.evaluationCase.type !== 'conversation') throw new Error('Conversation Case is required.');
  let sessionId = Object.values(input.initialStateIds.sessions)[0];
  const executionIds: string[] = [];
  const steps: unknown[] = [];
  const traceTargets: CaseTraceTarget[] = [];
  for (const step of input.evaluationCase.input.steps) {
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
    if (settled.status === 'failed') break;
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
  const understanding = await waitForBackgroundResult({
    deadlineMs: input.safetyDeadlineMs,
    wait: (timeoutMs) => input.runtime.host.discovery.waitInterestUnderstanding({ executionId, timeoutMs }),
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
    correlation: {
      interestUnderstandingId: understanding.value.interestUnderstandingId,
      executionId,
      sessionId,
    },
    expectation: 'required',
  });
  return execution({
    caseType: 'interest_understanding', terminalState: 'settled',
    productResult: { sourceConversation: conversation.result, understanding: understanding.value },
    ownerFacts: { understanding: understanding.value },
    businessIds: {
      sessionId,
      executionId,
      interestUnderstandingId: understanding.value.interestUnderstandingId,
    },
    traceTargets,
  });
}

async function executeCandidateSupply(input: CaseExecutionInput): Promise<CaseExecutionResult> {
  const receipt = await input.runtime.host.discovery.requestCandidateSupply({ trigger: 'evaluation' });
  if (!receipt) {
    return execution({
      caseType: 'candidate_supply', terminalState: 'settled',
      productResult: { receipt },
      ownerFacts: {},
      businessIds: {},
      traceTargets: [],
    });
  }
  const completion = await waitForBackgroundResult({
    deadlineMs: input.safetyDeadlineMs,
    wait: (timeoutMs) => input.runtime.host.discovery.waitCandidateSupplyCheck({
      candidateSupplyId: receipt.candidateSupplyId,
      timeoutMs,
    }),
  });
  if (completion.status === 'interrupted') {
    return execution({
      caseType: 'candidate_supply', terminalState: 'interrupted',
      productResult: { receipt },
      ownerFacts: {},
      businessIds: { candidateSupplyId: receipt.candidateSupplyId },
      traceTargets: [],
      interruption: safetyInterruption(input),
    });
  }
  const executionId = 'executionId' in completion.value ? completion.value.executionId : undefined;
  const facts = executionId
    ? await input.runtime.host.discovery.getCandidateSupplyFacts({ executionId })
    : undefined;
  return execution({
    caseType: 'candidate_supply', terminalState: 'settled',
    productResult: { receipt, completion: completion.value },
    ownerFacts: facts ?? {},
    businessIds: {
      candidateSupplyId: receipt.candidateSupplyId,
      ...(executionId ? { executionId } : {}),
    },
    traceTargets: executionId ? [{
      traceKind: 'candidate_supply',
      correlation: { candidateSupplyId: receipt.candidateSupplyId, executionId },
      expectation: 'required',
    }] : [],
  });
}

async function executeDailyRecommendation(input: CaseExecutionInput): Promise<CaseExecutionResult> {
  const accepted = await input.runtime.host.discovery.ensureDaily({ trigger: 'manual', now: input.now() });
  if (accepted.status !== 'started' && accepted.status !== 'in_progress') {
    return execution({
      caseType: 'daily_recommendation', terminalState: 'settled',
      productResult: { accepted },
      ownerFacts: {},
      businessIds: 'batchId' in accepted ? { dailyRecommendationBatchId: accepted.batchId } : {},
      traceTargets: [],
    });
  }
  const completion = await waitForBackgroundResult({
    deadlineMs: input.safetyDeadlineMs,
    wait: (timeoutMs) => input.runtime.host.discovery.waitDailyBatch({
      localDate: accepted.localDate,
      timeoutMs,
    }),
  });
  const traceTargets = dailyTraceTargets(accepted);
  const baseBusinessIds = {
    dailyRecommendationBatchId: accepted.batchId,
    initialExecutionId: accepted.executionId,
  };
  if (completion.status === 'interrupted') {
    return execution({
      caseType: 'daily_recommendation', terminalState: 'interrupted',
      productResult: { accepted },
      ownerFacts: {},
      businessIds: baseBusinessIds,
      traceTargets,
      interruption: safetyInterruption(input),
    });
  }
  const facts = await input.runtime.host.discovery.getDailyRecommendationFacts({
    executionId: completion.value.executionId,
    batchId: accepted.batchId,
    localDate: accepted.localDate,
  });
  return execution({
    caseType: 'daily_recommendation', terminalState: 'settled',
    productResult: { accepted, completion: completion.value },
    ownerFacts: facts,
    businessIds: {
      ...baseBusinessIds,
      settledExecutionId: completion.value.executionId,
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
  const receipt = updated.feedbackChange;
  if (!receipt?.changed || !receipt.feedbackChangeId) {
    return execution({
      caseType: 'preference_learning', terminalState: 'settled',
      productResult: { updated },
      ownerFacts: {},
      businessIds: { recommendationId },
      traceTargets: [],
    });
  }
  const completion = await waitForBackgroundResult({
    deadlineMs: input.safetyDeadlineMs,
    wait: (timeoutMs) => input.runtime.host.discovery.waitPreferenceLearning({
      feedbackChangeId: receipt.feedbackChangeId,
      timeoutMs,
    }),
  });
  if (completion.status === 'interrupted') {
    return execution({
      caseType: 'preference_learning', terminalState: 'interrupted',
      productResult: { updated },
      ownerFacts: {},
      businessIds: { recommendationId, feedbackChangeId: receipt.feedbackChangeId },
      traceTargets: [],
      interruption: safetyInterruption(input),
    });
  }
  const facts = completion.value.batchId
    ? await input.runtime.host.discovery.getPreferenceLearningFacts({ batchId: completion.value.batchId })
    : undefined;
  return execution({
    caseType: 'preference_learning', terminalState: 'settled',
    productResult: { updated, completion: completion.value },
    ownerFacts: facts ?? {},
    businessIds: {
      recommendationId,
      feedbackChangeId: receipt.feedbackChangeId,
      ...(completion.value.batchId ? { preferenceLearningBatchId: completion.value.batchId } : {}),
    },
    traceTargets: completion.value.batchId ? [{
      traceKind: 'preference_learning',
      correlation: { preferenceLearningBatchId: completion.value.batchId },
      expectation: 'required',
    }] : [],
  });
}

type CommittedRunResult = Awaited<ReturnType<ProductRuntime['host']['session']['readCommittedRun']>>;
type ConversationSettlement =
  | { readonly status: 'completed' | 'failed'; readonly result: CommittedRunResult }
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

async function waitForBackgroundResult<T>(input: {
  readonly deadlineMs: number;
  readonly wait: (timeoutMs: number) => Promise<
    | { readonly status: 'completed'; readonly value: T }
    | { readonly status: 'timed_out' }
  >;
}): Promise<ProductWaitResult<T>> {
  while (Date.now() < input.deadlineMs) {
    const timeoutMs = Math.min(300_000, Math.max(1, input.deadlineMs - Date.now()));
    const result = await input.wait(timeoutMs);
    if (result.status === 'completed') return result;
    if (timeoutMs === 1 || Date.now() >= input.deadlineMs) break;
  }
  return { status: 'interrupted' };
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

function dailyTraceTargets(
  value: Extract<Awaited<ReturnType<ProductRuntime['host']['discovery']['ensureDaily']>>, {
    readonly status: 'started' | 'in_progress';
  }>,
): CaseTraceTarget[] {
  return [{
    traceKind: 'daily_recommendation',
    correlation: { dailyRecommendationBatchId: value.batchId },
    expectation: 'required',
  }];
}

async function waitForNextPoll(deadlineMs: number): Promise<void> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
}
