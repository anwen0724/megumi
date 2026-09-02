/*
 * Sends one Evaluation Task through the existing ProductRuntime Host and returns its real result.
 */
import type { ProductRuntime } from '@megumi/composition';
import type { EvaluationTask } from '../contracts/evaluation-task';
import type { InstalledInitialStateIds } from './initial-state';
import type { TraceTarget } from './trace-evidence';

export type ProductExecutionOutcome =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'timed_out'; readonly message: string };

export interface ProductTaskExecution {
  readonly outcome: ProductExecutionOutcome;
  readonly productResult: unknown;
  readonly traceTargets: readonly TraceTarget[];
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

/** Calls the same public product operation used by a normal Host. */
export async function executeTask(input: {
  readonly task: EvaluationTask;
  readonly runtime: ProductRuntime;
  readonly initialStateIds: InstalledInitialStateIds;
  readonly candidateModel: { readonly providerId: string; readonly modelId: string };
  readonly now: () => string;
  readonly safetyWallClockLimitMs: number;
}): Promise<ProductTaskExecution> {
  const executionInput = { ...input, safetyDeadlineMs: Date.now() + input.safetyWallClockLimitMs };
  switch (executionInput.task.input.type) {
    case 'conversation': return executeConversation(executionInput);
    case 'interest_understanding': return executeInterestUnderstanding(executionInput);
    case 'candidate_supply': return executeCandidateSupply(executionInput);
    case 'daily_recommendation': return executeDailyRecommendation(executionInput);
    case 'preference_learning': return executePreferenceLearning(executionInput);
  }
}

type TaskExecutionInput = Parameters<typeof executeTask>[0] & { readonly safetyDeadlineMs: number };

async function executeConversation(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  if (input.task.input.type !== 'conversation') throw new Error('Conversation input is required.');
  let sessionId = Object.values(input.initialStateIds.sessions)[0];
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
      return {
        outcome: { status: 'failed', message: `Product did not start an Agent Execution: ${accepted.payload.type}.` },
        productResult: { steps, accepted },
        traceTargets,
      };
    }
    sessionId = accepted.payload.session.id;
    traceTargets.push(conversationTraceTarget({
      executionId: accepted.payload.run.executionId,
      sessionId,
      messageId: accepted.payload.userMessageId,
    }));
    const settled = await waitForCommittedConversation({
      runtime: input.runtime,
      sessionId,
      executionId: accepted.payload.run.executionId,
      timeoutMs: remainingSafetyMs(input.safetyDeadlineMs),
    });
    steps.push(settled.result);
    if (settled.outcome.status !== 'completed') {
      return { outcome: settled.outcome, productResult: { steps, sessionId }, traceTargets };
    }
  }
  return { outcome: { status: 'completed' }, productResult: { steps, sessionId }, traceTargets };
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
    return {
      outcome: { status: 'failed', message: `Product did not start the source Conversation: ${accepted.payload.type}.` },
      productResult: accepted,
      traceTargets: [],
    };
  }
  const conversation = await waitForCommittedConversation({
    runtime: input.runtime,
    sessionId,
    executionId: accepted.payload.run.executionId,
    timeoutMs: remainingSafetyMs(input.safetyDeadlineMs),
  });
  const traceTargets: TraceTarget[] = [conversationTraceTarget({
    executionId: accepted.payload.run.executionId,
    sessionId,
    messageId: accepted.payload.userMessageId,
  })];
  if (conversation.outcome.status !== 'completed') {
    return { outcome: conversation.outcome, productResult: { conversation: conversation.result }, traceTargets };
  }
  const understanding = await input.runtime.host.discovery.waitInterestUnderstanding({
    executionId: accepted.payload.run.executionId,
    timeoutMs: remainingSafetyMs(input.safetyDeadlineMs),
  });
  if (understanding.status !== 'completed') {
    return {
      outcome: { status: 'timed_out', message: 'Interest Understanding did not settle before timeout.' },
      productResult: { conversation: conversation.result, understanding },
      traceTargets,
    };
  }
  traceTargets.push({
    traceKind: 'interest_understanding',
    correlation: {
      interestUnderstandingId: understanding.value.interestUnderstandingId,
      executionId: accepted.payload.run.executionId,
      sessionId,
    },
    expectation: 'required',
  });
  return {
    outcome: { status: 'completed' },
    productResult: { conversation: conversation.result, understanding: understanding.value },
    traceTargets,
  };
}

async function executeCandidateSupply(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  const receipt = await input.runtime.host.discovery.requestCandidateSupply({ trigger: 'evaluation' });
  if (!receipt) {
    return {
      outcome: { status: 'failed', message: 'Product did not accept a Candidate Supply check.' },
      productResult: null,
      traceTargets: [],
    };
  }
  const completion = await input.runtime.host.discovery.waitCandidateSupplyCheck({
    candidateSupplyId: receipt.candidateSupplyId,
    timeoutMs: remainingSafetyMs(input.safetyDeadlineMs),
  });
  if (completion.status !== 'completed') {
    return {
      outcome: { status: 'timed_out', message: 'Candidate Supply did not settle before timeout.' },
      productResult: { receipt, completion },
      traceTargets: [],
    };
  }
  const executionId = completion.value.status === 'completed' ? completion.value.executionId : undefined;
  const facts = executionId
    ? await input.runtime.host.discovery.getCandidateSupplyFacts({ executionId })
    : undefined;
  return {
    outcome: completion.value.status === 'failed'
      ? { status: 'failed', message: completion.value.failure.message }
      : { status: 'completed' },
    productResult: { receipt, completion: completion.value, facts },
    traceTargets: executionId ? [{
      traceKind: 'candidate_supply',
      correlation: { candidateSupplyId: receipt.candidateSupplyId, executionId },
      expectation: 'required',
    }] : [],
    evidence: {
      context: facts?.status === 'ok' ? { supplyFacts: facts.facts } : {},
      output: { completion: completion.value },
    },
    businessMeasurements: {
      candidatesProduced: candidateProductionCount(completion.value),
    },
  };
}

async function executeDailyRecommendation(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  const accepted = await input.runtime.host.discovery.ensureDaily({ trigger: 'manual', now: input.now() });
  const completion = accepted.status === 'started' || accepted.status === 'in_progress'
    ? await input.runtime.host.discovery.waitDailyBatch({
        localDate: accepted.localDate,
        timeoutMs: remainingSafetyMs(input.safetyDeadlineMs),
      })
    : accepted;
  if ('status' in completion && completion.status === 'timed_out') {
    return {
      outcome: { status: 'timed_out', message: 'Daily Recommendation did not settle before timeout.' },
      productResult: { accepted, completion },
      traceTargets: dailyTraceTargets(accepted),
    };
  }
  const settledBatch = completion.status === 'completed' ? completion.value : completion;
  const facts = accepted.status === 'started' || accepted.status === 'in_progress'
    ? await input.runtime.host.discovery.getDailyRecommendationFacts({
        executionId: accepted.executionId,
        batchId: accepted.batchId,
        localDate: accepted.localDate,
      })
    : undefined;
  const failed = settledBatch.status === 'failed';
  return {
    outcome: failed
      ? {
          status: 'failed',
          message: 'failureMessage' in settledBatch
            ? settledBatch.failureMessage
            : settledBatch.failure.message,
        }
      : { status: 'completed' },
    productResult: { accepted, completion: settledBatch, facts },
    traceTargets: dailyTraceTargets(accepted),
    evidence: {
      context: facts?.status === 'ok'
        ? { recentRecommendations: facts.facts.recentRecommendations }
        : {},
      output: { currentBatch: settledBatch },
    },
    businessMeasurements: {
      recommendationsPublished: currentRecommendationCount(accepted, settledBatch),
    },
  };
}

async function executePreferenceLearning(input: TaskExecutionInput): Promise<ProductTaskExecution> {
  if (input.task.input.type !== 'preference_learning') throw new Error('Preference Learning input is required.');
  const recommendationId = input.initialStateIds.recommendations[input.task.input.recommendationReferenceId];
  if (!recommendationId) throw new Error(`Initial Recommendation was not installed: ${input.task.input.recommendationReferenceId}.`);
  const updated = await input.runtime.host.discovery.updateRecommendationState({
    recommendationId,
    action: 'set_reaction',
    reaction: input.task.input.reaction === 'none' ? null : input.task.input.reaction,
  });
  const receipt = updated.feedbackChange;
  if (!receipt?.changed || !receipt.feedbackChangeId) {
    return {
      outcome: { status: 'completed' },
      productResult: { updated },
      traceTargets: [],
      evidence: { input: { recommendationId, feedbackChange: updated.feedbackChange } },
      businessMeasurements: { preferenceRevisions: 0 },
    };
  }
  const completion = await input.runtime.host.discovery.waitPreferenceLearning({
    feedbackChangeId: receipt.feedbackChangeId,
    timeoutMs: remainingSafetyMs(input.safetyDeadlineMs),
  });
  if (completion.status !== 'completed') {
    return {
      outcome: { status: 'timed_out', message: 'Preference Learning did not settle before timeout.' },
      productResult: { updated, completion },
      traceTargets: [],
      evidence: { input: { recommendationId, feedbackChange: receipt } },
    };
  }
  const facts = completion.value.batchId
    ? await input.runtime.host.discovery.getPreferenceLearningFacts({ batchId: completion.value.batchId })
    : undefined;
  return {
    outcome: { status: 'completed' },
    productResult: { updated, completion: completion.value, facts },
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
      context: {
        preferenceRevisionsBefore: facts?.status === 'ok'
          ? facts.facts.currentPreferences.map(({ scopeKey, revision }) => ({ scopeKey, revision }))
          : [],
      },
      output: { preferenceRevisionsAfter: completion.value.resultRevisions },
    },
    businessMeasurements: {
      preferenceRevisions: completion.value.resultRevisions.length,
    },
  };
}

async function waitForCommittedConversation(input: {
  readonly runtime: ProductRuntime;
  readonly sessionId: string;
  readonly executionId: string;
  readonly timeoutMs: number;
}): Promise<{ readonly outcome: ProductExecutionOutcome; readonly result: unknown }> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() <= deadline) {
    const result = await input.runtime.host.session.readCommittedRun({
      sessionId: input.sessionId,
      executionId: input.executionId,
    });
    if (result.status === 'failed') {
      return { outcome: { status: 'failed', message: result.failure.message }, result };
    }
    if (result.status === 'ok') {
      const reply = result.messages.find((entry) => (
        entry.type === 'message' && entry.message.kind === 'assistantReply'
      ));
      if (reply?.type === 'message' && reply.message.kind === 'assistantReply') {
        if (reply.message.status === 'completed') return { outcome: { status: 'completed' }, result };
        if (reply.message.status === 'failed') {
          return {
            outcome: {
              status: 'failed',
              message: `Assistant Reply failed: ${reply.message.reasonCode}.`,
            },
            result,
          };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return {
    outcome: { status: 'timed_out', message: `Conversation Execution timed out: ${input.executionId}.` },
    result: { sessionId: input.sessionId, executionId: input.executionId },
  };
}

function conversationTraceTarget(correlation: {
  readonly executionId: string;
  readonly sessionId: string;
  readonly messageId: string;
}): TraceTarget {
  return { traceKind: 'conversation', correlation, expectation: 'required' };
}

function dailyTraceTargets(
  value: Awaited<ReturnType<ProductRuntime['host']['discovery']['ensureDaily']>>,
): TraceTarget[] {
  if (value.status === 'started' || value.status === 'in_progress') {
    return [{
      traceKind: 'daily_recommendation',
      correlation: {
        dailyRecommendationBatchId: value.batchId,
        executionId: value.executionId,
      },
      expectation: 'required',
    }];
  }
  return [];
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

function currentRecommendationCount(
  accepted: Awaited<ReturnType<ProductRuntime['host']['discovery']['ensureDaily']>>,
  completion: unknown,
): number | undefined {
  if (accepted.status !== 'started' && accepted.status !== 'in_progress') return 0;
  if (typeof completion !== 'object' || completion === null || !('status' in completion)) return undefined;
  if (completion.status === 'published' && 'resultCount' in completion && typeof completion.resultCount === 'number') {
    return completion.resultCount;
  }
  if (completion.status === 'failed') return 0;
  return undefined;
}

function remainingSafetyMs(deadlineMs: number): number {
  return Math.max(1, deadlineMs - Date.now());
}
