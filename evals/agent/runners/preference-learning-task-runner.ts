/* Runs Feedback-triggered Preference Learning through durable completion facts. */
import type { AnyEvent } from '@megumi/events';
import type { EvaluationTask } from '../contracts/evaluation-task';
import { toJsonRecord, type TaskRunner } from '../runtime/evidence-collector';

type PreferenceLearningTask = Extract<EvaluationTask, { runner: 'preference_learning' }>;

export const preferenceLearningTaskRunner: TaskRunner<PreferenceLearningTask> = {
  runner: 'preference_learning',
  async execute(context) {
    const recommendationId = context.scenarioIds.recommendations[context.task.input.recommendationId];
    if (!recommendationId) {
      throw new Error(`Scenario Recommendation not found: ${context.task.input.recommendationId}.`);
    }
    const runtimeEvents: AnyEvent[] = [];
    const subscription = context.runtime.subscribeRuntimeEvents({}, (event) => { runtimeEvents.push(event); });
    try {
      const before = await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 });
      const updated = await context.runtime.host.discovery.updateRecommendationState({
        recommendationId,
        action: 'set_reaction',
        reaction: context.task.input.reaction === 'none' ? null : context.task.input.reaction,
      });
      const receipt = updated.feedbackChange;
      if (!receipt?.changed || !receipt.feedbackChangeId) {
        return {
          input: toJsonRecord(context.task.input),
          beforeFacts: toJsonRecord(before),
          completion: toJsonRecord(receipt ?? { changed: false }),
          afterFacts: toJsonRecord(await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 })),
          correlations: [{ recommendationId }],
          runtimeEvents,
        };
      }
      const completion = await context.runtime.host.discovery.waitPreferenceLearning({
        feedbackChangeId: receipt.feedbackChangeId,
        timeoutMs: context.task.completion.timeoutMs,
      });
      if (completion.status !== 'completed') throw new Error('Preference Learning did not settle before timeout.');
      const learningFacts = completion.value.batchId
        ? await context.runtime.host.discovery.getPreferenceLearningFacts({ batchId: completion.value.batchId })
        : { status: 'failed' as const, failure: { code: 'no_batch', message: 'No Preference Learning Batch was created.' } };
      return {
        input: toJsonRecord(context.task.input),
        beforeFacts: toJsonRecord({ home: before, learningFacts }),
        completion: toJsonRecord(completion.value),
        afterFacts: toJsonRecord(await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 })),
        correlations: [{
          recommendationId,
          ...(completion.value.batchId ? { batchId: completion.value.batchId } : {}),
        }],
        runtimeEvents,
      };
    } finally {
      subscription.unsubscribe();
    }
  },
};
