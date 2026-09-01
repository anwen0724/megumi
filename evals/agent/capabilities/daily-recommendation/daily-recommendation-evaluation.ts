/* Evaluates real Daily Recommendation selection and publication over a fixed Pool. */
import type { EvaluationCase } from '../../catalog/evaluation-case';
import { toJsonRecord, type CapabilityEvaluation } from '../../runtime/evidence';

type DailyRecommendationCase = Extract<EvaluationCase, { capability: 'daily_recommendation' }>;

export const dailyRecommendationEvaluation: CapabilityEvaluation<DailyRecommendationCase> = {
  capability: 'daily_recommendation',
  async execute(context) {
    const before = await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 });
    const accepted = await context.runtime.host.discovery.ensureDaily({ trigger: 'manual', now: context.now() });
    const completion = accepted.status === 'started' || accepted.status === 'in_progress'
      ? await context.runtime.host.discovery.waitDailyBatch({
          localDate: accepted.localDate,
          timeoutMs: context.evaluationCase.completion.timeoutMs,
        })
      : accepted;
    if ('status' in completion && completion.status === 'timed_out') {
      throw new Error('Daily Recommendation Batch did not settle before timeout.');
    }
    const recommendationFacts = accepted.status === 'started' || accepted.status === 'in_progress'
      ? await context.runtime.host.discovery.getDailyRecommendationFacts({
          executionId: accepted.executionId,
          batchId: accepted.batchId,
          localDate: accepted.localDate,
        })
      : { status: 'failed' as const, failure: { code: 'no_execution', message: 'No Recommendation Execution started.' } };
    const after = await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 });
    const correlation: Record<string, string> = {};
    if (accepted.status === 'started' || accepted.status === 'in_progress') {
      correlation.executionId = accepted.executionId;
      correlation.batchId = accepted.batchId;
    } else if ('batchId' in accepted) {
      correlation.batchId = accepted.batchId;
    }
    return {
      input: toJsonRecord(context.evaluationCase.trigger),
      beforeFacts: toJsonRecord({ home: before, recommendationFacts }),
      completion: toJsonRecord({ accepted, completion }),
      afterFacts: toJsonRecord(after),
      correlation,
      runtimeEvents: [],
    };
  },
};
