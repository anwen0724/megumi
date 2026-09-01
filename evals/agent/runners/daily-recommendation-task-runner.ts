/* Runs Daily Recommendation selection and publication over the Scenario Candidate Pool. */
import type { AnyEvent } from '@megumi/events';
import type { EvaluationTask } from '../contracts/evaluation-task';
import { toJsonRecord, type TaskRunner } from '../runtime/evidence-collector';

type DailyRecommendationTask = Extract<EvaluationTask, { runner: 'daily_recommendation' }>;

export const dailyRecommendationTaskRunner: TaskRunner<DailyRecommendationTask> = {
  runner: 'daily_recommendation',
  async execute(context) {
    const runtimeEvents: AnyEvent[] = [];
    const subscription = context.runtime.subscribeRuntimeEvents({}, (event) => { runtimeEvents.push(event); });
    try {
      const before = await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 });
      const accepted = await context.runtime.host.discovery.ensureDaily({ trigger: 'manual', now: context.now() });
      const completion = accepted.status === 'started' || accepted.status === 'in_progress'
        ? await context.runtime.host.discovery.waitDailyBatch({
            localDate: accepted.localDate,
            timeoutMs: context.task.completion.timeoutMs,
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
      const correlation: Record<string, string> = {};
      if (accepted.status === 'started' || accepted.status === 'in_progress') {
        correlation.executionId = accepted.executionId;
        correlation.batchId = accepted.batchId;
      } else if ('batchId' in accepted) {
        correlation.batchId = accepted.batchId;
      }
      return {
        input: toJsonRecord(context.task.input),
        beforeFacts: toJsonRecord({ home: before, recommendationFacts }),
        completion: toJsonRecord({ accepted, completion }),
        afterFacts: toJsonRecord(await context.runtime.host.discovery.getHome({ mode: 'timeline', limit: 100 })),
        correlations: Object.keys(correlation).length > 0 ? [correlation] : [],
        runtimeEvents,
      };
    } finally {
      subscription.unsubscribe();
    }
  },
};
