/* Evaluates Feedback-triggered Preference Learning through durable completion facts. */
import type { EvaluationCase } from '../../catalog/evaluation-case';
import { toJsonRecord, type CapabilityEvaluation } from '../../runtime/evidence';

type PreferenceLearningCase = Extract<EvaluationCase, { capability: 'preference_learning' }>;

export const preferenceLearningEvaluation: CapabilityEvaluation<PreferenceLearningCase> = {
  capability: 'preference_learning',
  async execute(context) {
    const recommendationId = context.fixtureIds.recommendations[context.evaluationCase.trigger.recommendationId];
    if (!recommendationId) throw new Error(`Fixture Recommendation not found: ${context.evaluationCase.trigger.recommendationId}.`);
    const before = await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 });
    const updated = await context.runtime.host.discovery.updateRecommendationState({
      recommendationId,
      action: 'set_reaction',
      reaction: context.evaluationCase.trigger.reaction === 'none' ? null : context.evaluationCase.trigger.reaction,
    });
    const receipt = updated.feedbackChange;
    if (!receipt?.changed || !receipt.feedbackChangeId) {
      return {
        input: toJsonRecord(context.evaluationCase.trigger),
        beforeFacts: toJsonRecord(before),
        completion: toJsonRecord(receipt ?? { changed: false }),
        afterFacts: toJsonRecord(await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 })),
        correlation: { recommendationId },
        runtimeEvents: [],
      };
    }
    const completion = await context.runtime.host.discovery.waitPreferenceLearning({
      feedbackChangeId: receipt.feedbackChangeId,
      timeoutMs: context.evaluationCase.completion.timeoutMs,
    });
    if (completion.status !== 'completed') throw new Error('Preference Learning did not settle before timeout.');
    const learningFacts = completion.value.batchId
      ? await context.runtime.host.discovery.getPreferenceLearningFacts({ batchId: completion.value.batchId })
      : { status: 'failed' as const, failure: { code: 'no_batch', message: 'No Preference Learning Batch was created.' } };
    return {
      input: toJsonRecord(context.evaluationCase.trigger),
      beforeFacts: toJsonRecord({ home: before, learningFacts }),
      completion: toJsonRecord(completion.value),
      afterFacts: toJsonRecord(await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 })),
      correlation: {
        recommendationId,
        ...(completion.value.batchId ? { batchId: completion.value.batchId } : {}),
      },
      runtimeEvents: [],
    };
  },
};
