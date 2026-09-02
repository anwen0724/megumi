/*
 * Sends one Evaluation Task through the existing ProductRuntime Host and preserves
 * the owning product operation's returned result without inventing a shared status.
 */
import type { ProductRuntime } from '@megumi/composition';
import type { EvaluationTask } from '../contracts/evaluation-task';
import type { InstalledInitialStateIds } from './initial-state';
import type { TraceTarget } from './trace-evidence';

export interface EvaluationSafetyInterruption {
  readonly source: 'evaluation_safety_guard';
  readonly limitMs: number;
}

export interface ProductTaskExecution {
  readonly operation: EvaluationTask['input']['type'];
  readonly productResult: unknown;
  readonly businessIds: Readonly<Record<string, string | string[]>>;
  readonly traceTargets: readonly TraceTarget[];
  readonly interruption?: EvaluationSafetyInterruption;
  readonly evidence?: {
    readonly input?: Readonly<Record<string, unknown>>;
    readonly context?: Readonly<Record<string, unknown>>;
    readonly output?: Readonly<Record<string, unknown>>;
  };
  readonly businessMeasurements?: {
    readonly candidatesProduced?: number;
    readonly recommendationsPublished?: number;
    readonly preferenceRevisions?: number;
  };
}

interface TaskExecutionInput {
  readonly task: EvaluationTask;
  readonly runtime: ProductRuntime;
  readonly initialStateIds: InstalledInitialStateIds;
  readonly candidateModel: { readonly providerId: string; readonly modelId: string };
  readonly now: () => string;
  readonly safetyWallClockLimitMs: number;
  readonly safetyDeadlineMs: number;
}

/** Calls the same public product operation used by a normal Host. */
export async function executeTask(input: Omit<TaskExecutionInput, 'safetyDeadlineMs'>): Promise<ProductTaskExecution> {
  const executionInput: TaskExecutionInput = {
    ...input,
    safetyDeadlineMs: Date.now() + input.safetyWallClockLimitMs,
  };
  switch (executionInput.task.input.type) {
    case 'conversation': return executeConversation(executionInput);
    case 'interest_understanding': return executeInterestUnderstanding(executionInput);
    case 'candidate_supply': return executeCandidateSupply(executionInput);
    case 'daily_recommendation': return executeDailyRecommendation(executionInput);
    case 'preference_learning': return executePreferenceLearning(executionInput);
  }
}

async function executeConversation(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  if (input.task.input.type !== 'conversation') throw new Error('Conversation input is required.');
  let sessionId = Object.values(input.initialStateIds.sessions)[0];
  const executionIds: string[] = [];
  const steps: unknown[] = [];
  const traceTargets: TraceTarget[] = [];
  for (const step of input.task.input.steps) {
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
        operation: 'conversation',
        productResult: { steps, acceptance: accepted },
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
        operation: 'conversation',
        productResult: { steps, sessionId },
        businessIds: { sessionId, executionIds },
        traceTargets,
        interruption: safetyInterruption(input),
      });
    }
    if (settled.status === 'failed') break;
  }
  return execution({
    operation: 'conversation',
    productResult: { steps, sessionId },
    businessIds: { ...(sessionId ? { sessionId } : {}), executionIds },
    traceTargets,
  });
}

async function executeInterestUnderstanding(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  if (input.task.input.type !== 'interest_understanding') throw new Error('Interest Understanding input is required.');
  const sessionId = Object.values(input.initialStateIds.sessions)[0];
  if (!sessionId) throw new Error('Interest Understanding requires one initial Session.');
  const accepted = await input.runtime.host.session.sendUserInput({
    sessionId,
    projectId: input.initialStateIds.workspaceId,
    text: input.task.input.text,
    modelSelection: {
      provider_id: input.candidateModel.providerId,
      model_id: input.candidateModel.modelId,
    },
    permissionMode: 'auto',
    createdAt: input.now(),
  });
  if (accepted.payload.type !== 'agent_run') {
    return execution({
      operation: 'interest_understanding',
      productResult: { sourceConversation: { acceptance: accepted } },
      businessIds: { sessionId },
      traceTargets: [],
    });
  }
  const executionId = accepted.payload.run.executionId;
  const traceTargets: TraceTarget[] = [conversationTraceTarget({
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
      operation: 'interest_understanding',
      productResult: { sourceConversation: conversation.result },
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
      operation: 'interest_understanding',
      productResult: { sourceConversation: conversation.result },
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
    operation: 'interest_understanding',
    productResult: { sourceConversation: conversation.result, understanding: understanding.value },
    businessIds: {
      sessionId,
      executionId,
      interestUnderstandingId: understanding.value.interestUnderstandingId,
    },
    traceTargets,
  });
}

async function executeCandidateSupply(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  const receipt = await input.runtime.host.discovery.requestCandidateSupply({ trigger: 'evaluation' });
  if (!receipt) {
    return execution({
      operation: 'candidate_supply',
      productResult: { receipt },
      businessIds: {},
      traceTargets: [],
      businessMeasurements: { candidatesProduced: 0 },
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
      operation: 'candidate_supply',
      productResult: { receipt },
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
    operation: 'candidate_supply',
    productResult: { receipt, completion: completion.value, facts },
    businessIds: {
      candidateSupplyId: receipt.candidateSupplyId,
      ...(executionId ? { executionId } : {}),
    },
    traceTargets: executionId ? [{
      traceKind: 'candidate_supply',
      correlation: { candidateSupplyId: receipt.candidateSupplyId, executionId },
      expectation: 'required',
    }] : [],
    evidence: {
      context: facts?.status === 'ok' ? { supplyFacts: facts.facts } : {},
      output: { completion: completion.value },
    },
    businessMeasurements: { candidatesProduced: candidateProductionCount(completion.value) },
  });
}

async function executeDailyRecommendation(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  const accepted = await input.runtime.host.discovery.ensureDaily({ trigger: 'manual', now: input.now() });
  if (accepted.status !== 'started' && accepted.status !== 'in_progress') {
    return execution({
      operation: 'daily_recommendation',
      productResult: { accepted },
      businessIds: 'batchId' in accepted ? { dailyRecommendationBatchId: accepted.batchId } : {},
      traceTargets: [],
      businessMeasurements: {
        recommendationsPublished: accepted.status === 'already_published' ? accepted.resultCount : 0,
      },
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
  const businessIds = {
    dailyRecommendationBatchId: accepted.batchId,
    initialExecutionId: accepted.executionId,
  };
  if (completion.status === 'interrupted') {
    return execution({
      operation: 'daily_recommendation',
      productResult: { accepted },
      businessIds,
      traceTargets,
      interruption: safetyInterruption(input),
    });
  }
  const facts = await input.runtime.host.discovery.getDailyRecommendationFacts({
    executionId: accepted.executionId,
    batchId: accepted.batchId,
    localDate: accepted.localDate,
  });
  return execution({
    operation: 'daily_recommendation',
    productResult: { accepted, completion: completion.value, facts },
    businessIds,
    traceTargets,
    evidence: {
      context: facts.status === 'ok' ? { recentRecommendations: facts.facts.recentRecommendations } : {},
      output: { currentBatch: completion.value },
    },
    businessMeasurements: {
      recommendationsPublished: currentRecommendationCount(completion.value),
    },
  });
}

async function executePreferenceLearning(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  if (input.task.input.type !== 'preference_learning') throw new Error('Preference Learning input is required.');
  const recommendationId = input.initialStateIds.recommendations[input.task.input.recommendationReferenceId];
  if (!recommendationId) {
    throw new Error(`Initial Recommendation was not installed: ${input.task.input.recommendationReferenceId}.`);
  }
  const updated = await input.runtime.host.discovery.updateRecommendationState({
    recommendationId,
    action: 'set_reaction',
    reaction: input.task.input.reaction === 'none' ? null : input.task.input.reaction,
  });
  const receipt = updated.feedbackChange;
  if (!receipt?.changed || !receipt.feedbackChangeId) {
    return execution({
      operation: 'preference_learning',
      productResult: { updated },
      businessIds: { recommendationId },
      traceTargets: [],
      evidence: {
        input: { recommendationId, feedbackChange: updated.feedbackChange },
        context: { preferencesBefore: input.task.initialState.preferences },
      },
      businessMeasurements: { preferenceRevisions: 0 },
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
      operation: 'preference_learning',
      productResult: { updated },
      businessIds: { recommendationId, feedbackChangeId: receipt.feedbackChangeId },
      traceTargets: [],
      interruption: safetyInterruption(input),
      evidence: {
        input: { recommendationId, feedbackChange: receipt },
        context: { preferencesBefore: input.task.initialState.preferences },
      },
    });
  }
  const facts = completion.value.batchId
    ? await input.runtime.host.discovery.getPreferenceLearningFacts({ batchId: completion.value.batchId })
    : undefined;
  return execution({
    operation: 'preference_learning',
    productResult: { updated, completion: completion.value, facts },
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
    evidence: {
      input: {
        recommendationId,
        feedbackChangeId: receipt.feedbackChangeId,
        batchFeedback: facts?.status === 'ok' ? facts.facts.feedbackChanges : [],
      },
      context: { preferencesBefore: input.task.initialState.preferences },
      output: {
        completion: completion.value,
        preferencesAfter: facts?.status === 'ok' ? facts.facts.currentPreferences : [],
      },
    },
    businessMeasurements: { preferenceRevisions: completion.value.resultRevisions.length },
  });
}

type CommittedRunResult = Awaited<ReturnType<ProductRuntime['host']['session']['readCommittedRun']>>;
type ConversationSettlement =
  | { readonly status: 'completed' | 'failed'; readonly result: CommittedRunResult }
  | { readonly status: 'interrupted'; readonly result: Readonly<Record<string, string>> };

async function waitForCommittedConversation(input: {
  readonly runtime: ProductRuntime;
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

function execution(value: ProductTaskExecution): ProductTaskExecution {
  return value;
}

function safetyInterruption(input: TaskExecutionInput): EvaluationSafetyInterruption {
  return { source: 'evaluation_safety_guard', limitMs: input.safetyWallClockLimitMs };
}

function conversationTraceTarget(correlation: {
  readonly executionId: string;
  readonly sessionId: string;
  readonly messageId: string;
}): TraceTarget {
  return { traceKind: 'conversation', correlation, expectation: 'required' };
}

function dailyTraceTargets(
  value: Extract<Awaited<ReturnType<ProductRuntime['host']['discovery']['ensureDaily']>>, {
    readonly status: 'started' | 'in_progress';
  }>,
): TraceTarget[] {
  return [{
    traceKind: 'daily_recommendation',
    correlation: { dailyRecommendationBatchId: value.batchId },
    expectation: 'required',
  }];
}

type CandidateSupplyCompletion = NonNullable<Awaited<ReturnType<
  ProductRuntime['host']['discovery']['getCandidateSupplyCheck']
>>>;

function candidateProductionCount(value: CandidateSupplyCompletion): number | undefined {
  if (value.status !== 'completed') return 0;
  if (!value.executionId) return 0;
  if (value.availableBefore === undefined || value.availableAfter === undefined) return undefined;
  return Math.max(0, value.availableAfter - value.availableBefore);
}

type DailyBatch = NonNullable<Awaited<ReturnType<ProductRuntime['host']['discovery']['getDailyBatch']>>>;

function currentRecommendationCount(completion: DailyBatch): number {
  return completion.status === 'published' ? completion.resultCount : 0;
}

async function waitForNextPoll(deadlineMs: number): Promise<void> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
}
