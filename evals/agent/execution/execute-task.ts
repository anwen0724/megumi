/*
 * Sends one Evaluation Task through the existing ProductRuntime Host and returns its real result.
 */
import type { ProductRuntime } from '@megumi/composition';
import type { EvaluationTask } from '../contracts/evaluation-task';
import type { InstalledInitialStateIds } from './initial-state';

export type ProductExecutionOutcome =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'timed_out'; readonly message: string };

export interface ProductTaskExecution {
  readonly outcome: ProductExecutionOutcome;
  readonly productResult: unknown;
  readonly correlations: readonly Readonly<Record<string, string>>[];
}

/** Calls the same public product operation used by a normal Host. */
export async function executeTask(input: {
  readonly task: EvaluationTask;
  readonly runtime: ProductRuntime;
  readonly initialStateIds: InstalledInitialStateIds;
  readonly candidateModel: { readonly providerId: string; readonly modelId: string };
  readonly now: () => string;
}): Promise<ProductTaskExecution> {
  switch (input.task.input.type) {
    case 'conversation': return executeConversation(input);
    case 'interest_understanding': return executeInterestUnderstanding(input);
    case 'candidate_supply': return executeCandidateSupply(input);
    case 'daily_recommendation': return executeDailyRecommendation(input);
    case 'preference_learning': return executePreferenceLearning(input);
  }
}

async function executeConversation(input: Parameters<typeof executeTask>[0]): Promise<ProductTaskExecution> {
  if (input.task.input.type !== 'conversation') throw new Error('Conversation input is required.');
  let sessionId = Object.values(input.initialStateIds.sessions)[0];
  const steps: unknown[] = [];
  const correlations: Record<string, string>[] = [];
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
        correlations,
      };
    }
    sessionId = accepted.payload.session.id;
    correlations.push({
      executionId: accepted.payload.run.executionId,
      sessionId,
      messageId: accepted.payload.userMessageId,
    });
    const settled = await waitForCommittedConversation({
      runtime: input.runtime,
      sessionId,
      executionId: accepted.payload.run.executionId,
      timeoutMs: input.task.timeoutMs,
    });
    steps.push(settled.result);
    if (settled.outcome.status !== 'completed') {
      return { outcome: settled.outcome, productResult: { steps, sessionId }, correlations };
    }
  }
  return { outcome: { status: 'completed' }, productResult: { steps, sessionId }, correlations };
}

async function executeInterestUnderstanding(input: Parameters<typeof executeTask>[0]): Promise<ProductTaskExecution> {
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
      correlations: [],
    };
  }
  const conversation = await waitForCommittedConversation({
    runtime: input.runtime,
    sessionId,
    executionId: accepted.payload.run.executionId,
    timeoutMs: input.task.timeoutMs,
  });
  const correlations: Record<string, string>[] = [{
    executionId: accepted.payload.run.executionId,
    sessionId,
    messageId: accepted.payload.userMessageId,
  }];
  if (conversation.outcome.status !== 'completed') {
    return { outcome: conversation.outcome, productResult: { conversation: conversation.result }, correlations };
  }
  const understanding = await input.runtime.host.discovery.waitInterestUnderstanding({
    executionId: accepted.payload.run.executionId,
    timeoutMs: input.task.timeoutMs,
  });
  if (understanding.status !== 'completed') {
    return {
      outcome: { status: 'timed_out', message: 'Interest Understanding did not settle before timeout.' },
      productResult: { conversation: conversation.result, understanding },
      correlations,
    };
  }
  correlations.push({
    interestUnderstandingId: understanding.value.interestUnderstandingId,
    executionId: accepted.payload.run.executionId,
    sessionId,
  });
  return {
    outcome: { status: 'completed' },
    productResult: { conversation: conversation.result, understanding: understanding.value },
    correlations,
  };
}

async function executeCandidateSupply(input: Parameters<typeof executeTask>[0]): Promise<ProductTaskExecution> {
  const receipt = await input.runtime.host.discovery.requestCandidateSupply({ trigger: 'evaluation' });
  if (!receipt) {
    return {
      outcome: { status: 'failed', message: 'Product did not accept a Candidate Supply check.' },
      productResult: null,
      correlations: [],
    };
  }
  const completion = await input.runtime.host.discovery.waitCandidateSupplyCheck({
    candidateSupplyCheckId: receipt.candidateSupplyCheckId,
    timeoutMs: input.task.timeoutMs,
  });
  if (completion.status !== 'completed') {
    return {
      outcome: { status: 'timed_out', message: 'Candidate Supply did not settle before timeout.' },
      productResult: { receipt, completion },
      correlations: [{ candidateSupplyCheckId: receipt.candidateSupplyCheckId }],
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
    correlations: [{
      candidateSupplyCheckId: receipt.candidateSupplyCheckId,
      ...(executionId ? { executionId } : {}),
    }],
  };
}

async function executeDailyRecommendation(input: Parameters<typeof executeTask>[0]): Promise<ProductTaskExecution> {
  const accepted = await input.runtime.host.discovery.ensureDaily({ trigger: 'manual', now: input.now() });
  const completion = accepted.status === 'started' || accepted.status === 'in_progress'
    ? await input.runtime.host.discovery.waitDailyBatch({
        localDate: accepted.localDate,
        timeoutMs: input.task.timeoutMs,
      })
    : accepted;
  if ('status' in completion && completion.status === 'timed_out') {
    return {
      outcome: { status: 'timed_out', message: 'Daily Recommendation did not settle before timeout.' },
      productResult: { accepted, completion },
      correlations: dailyCorrelations(accepted),
    };
  }
  const facts = accepted.status === 'started' || accepted.status === 'in_progress'
    ? await input.runtime.host.discovery.getDailyRecommendationFacts({
        executionId: accepted.executionId,
        batchId: accepted.batchId,
        localDate: accepted.localDate,
      })
    : undefined;
  const failed = 'status' in completion && completion.status === 'failed';
  return {
    outcome: failed
      ? { status: 'failed', message: completion.failure.message }
      : { status: 'completed' },
    productResult: { accepted, completion, facts },
    correlations: dailyCorrelations(accepted),
  };
}

async function executePreferenceLearning(input: Parameters<typeof executeTask>[0]): Promise<ProductTaskExecution> {
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
      correlations: [{ recommendationId }],
    };
  }
  const completion = await input.runtime.host.discovery.waitPreferenceLearning({
    feedbackChangeId: receipt.feedbackChangeId,
    timeoutMs: input.task.timeoutMs,
  });
  if (completion.status !== 'completed') {
    return {
      outcome: { status: 'timed_out', message: 'Preference Learning did not settle before timeout.' },
      productResult: { updated, completion },
      correlations: [{ recommendationId, feedbackChangeId: receipt.feedbackChangeId }],
    };
  }
  const facts = completion.value.batchId
    ? await input.runtime.host.discovery.getPreferenceLearningFacts({ batchId: completion.value.batchId })
    : undefined;
  return {
    outcome: { status: 'completed' },
    productResult: { updated, completion: completion.value, facts },
    correlations: [{
      recommendationId,
      feedbackChangeId: receipt.feedbackChangeId,
      ...(completion.value.batchId ? { batchId: completion.value.batchId } : {}),
    }],
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

function dailyCorrelations(value: Awaited<ReturnType<ProductRuntime['host']['discovery']['ensureDaily']>>): Readonly<Record<string, string>>[] {
  if (value.status === 'started' || value.status === 'in_progress') {
    return [{ executionId: value.executionId, batchId: value.batchId, localDate: value.localDate }];
  }
  return 'batchId' in value
    ? [{ batchId: value.batchId, localDate: value.localDate }]
    : [{ localDate: value.localDate }];
}
