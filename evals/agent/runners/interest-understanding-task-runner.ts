/* Runs the independent Interest Understanding work triggered by a completed turn. */
import type { AnyEvent } from '@megumi/events';
import type { EvaluationTask } from '../contracts/evaluation-task';
import { toJsonRecord, waitForCommittedRun, type TaskRunner } from '../runtime/evidence-collector';

type InterestUnderstandingTask = Extract<EvaluationTask, { runner: 'interest_understanding' }>;

export const interestUnderstandingTaskRunner: TaskRunner<InterestUnderstandingTask> = {
  runner: 'interest_understanding',
  async execute(context) {
    const sessionId = Object.values(context.scenarioIds.sessions)[0];
    if (!sessionId) throw new Error('Interest Understanding Task requires one Scenario Session.');
    const runtimeEvents: AnyEvent[] = [];
    const subscription = context.runtime.subscribeRuntimeEvents({}, (event) => { runtimeEvents.push(event); });
    try {
      const before = await context.runtime.host.discovery.getConfiguration({});
      const conversation = await context.runtime.host.session.sendUserInput({
        sessionId,
        projectId: context.scenarioIds.workspaceId,
        text: context.task.input.text,
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
        timeoutMs: context.task.completion.timeoutMs,
      });
      const completion = await context.runtime.host.discovery.waitInterestUnderstanding({
        executionId: conversation.payload.run.executionId,
        timeoutMs: context.task.completion.timeoutMs,
      });
      if (completion.status !== 'completed') throw new Error('Interest Understanding did not settle before timeout.');
      return {
        input: toJsonRecord(context.task.input),
        beforeFacts: toJsonRecord(before),
        completion: toJsonRecord(completion.value),
        afterFacts: toJsonRecord(await context.runtime.host.discovery.getConfiguration({})),
        correlations: [{
          interestUnderstandingId: completion.value.interestUnderstandingId,
          executionId: conversation.payload.run.executionId,
          sessionId,
        }],
        runtimeEvents,
      };
    } finally {
      subscription.unsubscribe();
    }
  },
};
