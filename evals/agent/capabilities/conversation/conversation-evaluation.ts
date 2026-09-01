/* Evaluates one real Conversation Agent Execution from Product input to committed reply. */
import type { EvaluationCase } from '../../catalog/evaluation-case';
import {
  toJsonRecord,
  waitForCommittedRun,
  type CapabilityEvaluation,
} from '../../runtime/evidence';

type ConversationCase = Extract<EvaluationCase, { capability: 'conversation' }>;

export const conversationEvaluation: CapabilityEvaluation<ConversationCase> = {
  capability: 'conversation',
  async execute(context) {
    const sessionId = Object.values(context.fixtureIds.sessions)[0];
    const before = sessionId
      ? await context.runtime.host.session.readSession({ sessionId })
      : { status: 'new_session' };
    const runtimeEvents: import('@megumi/events').AnyEvent[] = [];
    const subscription = context.runtime.subscribeRuntimeEvents({}, (event) => { runtimeEvents.push(event); });
    try {
      const result = await context.runtime.host.session.sendUserInput({
        ...(sessionId ? { sessionId } : {}),
        projectId: context.fixtureIds.workspaceId,
        text: context.evaluationCase.trigger.text,
        modelSelection: {
          provider_id: context.runConfig.candidateModel.providerId,
          model_id: context.runConfig.candidateModel.modelId,
        },
        permissionMode: context.evaluationCase.trigger.permissionMode,
        createdAt: context.now(),
      });
      if (result.payload.type !== 'agent_run') {
        throw new Error(`Conversation did not start an Agent Execution: ${result.payload.type}.`);
      }
      const payload = result.payload;
      const completion = await waitForCommittedRun({
        runtime: context.runtime,
        sessionId: payload.session.id,
        executionId: payload.run.executionId,
        timeoutMs: context.evaluationCase.completion.timeoutMs,
      });
      const after = await context.runtime.host.session.readSession({ sessionId: payload.session.id });
      return {
        input: toJsonRecord({ text: context.evaluationCase.trigger.text, permissionMode: context.evaluationCase.trigger.permissionMode }),
        beforeFacts: toJsonRecord(before),
        completion,
        afterFacts: toJsonRecord(after),
        correlation: {
          executionId: payload.run.executionId,
          sessionId: payload.session.id,
          messageId: payload.userMessageId,
        },
        runtimeEvents: runtimeEvents.filter((event) => event.executionId === payload.run.executionId),
      };
    } finally {
      subscription.unsubscribe();
    }
  },
};
