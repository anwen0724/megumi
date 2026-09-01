/* Evaluates the independent Interest Understanding work triggered by a completed turn. */
import type { EvaluationCase } from '../../catalog/evaluation-case';
import { toJsonRecord, waitForCommittedRun, type CapabilityEvaluation } from '../../runtime/evidence';

type InterestCase = Extract<EvaluationCase, { capability: 'interest_understanding' }>;

export const interestUnderstandingEvaluation: CapabilityEvaluation<InterestCase> = {
  capability: 'interest_understanding',
  async execute(context) {
    const sessionId = Object.values(context.fixtureIds.sessions)[0];
    if (!sessionId) throw new Error('Interest Understanding Case requires one Fixture Session.');
    const before = await context.runtime.host.discovery.getConfiguration({});
    const conversation = await context.runtime.host.session.sendUserInput({
      sessionId,
      projectId: context.fixtureIds.workspaceId,
      text: context.evaluationCase.trigger.text,
      modelSelection: {
        provider_id: context.runConfig.candidateModel.providerId,
        model_id: context.runConfig.candidateModel.modelId,
      },
      permissionMode: 'auto',
      createdAt: context.now(),
    });
    if (conversation.payload.type !== 'agent_run') {
      throw new Error(`Interest source turn did not start: ${conversation.payload.type}.`);
    }
    await waitForCommittedRun({
      runtime: context.runtime,
      sessionId,
      executionId: conversation.payload.run.executionId,
      timeoutMs: context.evaluationCase.completion.timeoutMs,
    });
    const completion = await context.runtime.host.discovery.waitInterestUnderstanding({
      executionId: conversation.payload.run.executionId,
      timeoutMs: context.evaluationCase.completion.timeoutMs,
    });
    if (completion.status !== 'completed') throw new Error('Interest Understanding did not settle before timeout.');
    const after = await context.runtime.host.discovery.getConfiguration({});
    return {
      input: toJsonRecord({ text: context.evaluationCase.trigger.text }),
      beforeFacts: toJsonRecord(before),
      completion: toJsonRecord(completion.value),
      afterFacts: toJsonRecord(after),
      correlation: {
        interestUnderstandingId: completion.value.interestUnderstandingId,
        executionId: conversation.payload.run.executionId,
        sessionId,
      },
      runtimeEvents: [],
    };
  },
};
