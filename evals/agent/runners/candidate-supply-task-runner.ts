/* Runs one receipted Candidate Supply check through durable settlement. */
import type { AnyEvent } from '@megumi/events';
import type { EvaluationTask } from '../contracts/evaluation-task';
import { toJsonRecord, type TaskRunner } from '../runtime/evidence-collector';

type CandidateSupplyTask = Extract<EvaluationTask, { runner: 'candidate_supply' }>;

export const candidateSupplyTaskRunner: TaskRunner<CandidateSupplyTask> = {
  runner: 'candidate_supply',
  async execute(context) {
    const runtimeEvents: AnyEvent[] = [];
    const subscription = context.runtime.subscribeRuntimeEvents({}, (event) => { runtimeEvents.push(event); });
    try {
      const before = await context.runtime.host.discovery.getConfiguration({});
      const receipt = await context.runtime.host.discovery.requestCandidateSupply({ trigger: 'evaluation' });
      if (!receipt) throw new Error('Candidate Supply did not return a Check receipt.');
      const completion = await context.runtime.host.discovery.waitCandidateSupplyCheck({
        candidateSupplyCheckId: receipt.candidateSupplyCheckId,
        timeoutMs: context.task.completion.timeoutMs,
      });
      if (completion.status !== 'completed') throw new Error('Candidate Supply Check did not settle before timeout.');
      const executionId = completion.value.status === 'completed' ? completion.value.executionId : undefined;
      const supplyFacts = executionId
        ? await context.runtime.host.discovery.getCandidateSupplyFacts({ executionId })
        : { status: 'failed' as const, failure: { code: 'no_execution', message: 'The check did not start an Agent Execution.' } };
      return {
        input: toJsonRecord(context.task.input),
        beforeFacts: toJsonRecord({ configuration: before, supplyFacts }),
        completion: toJsonRecord(completion.value),
        afterFacts: toJsonRecord({
          configuration: await context.runtime.host.discovery.getConfiguration({}),
          supplyFacts,
        }),
        correlations: executionId ? [{ executionId }] : [],
        runtimeEvents,
      };
    } finally {
      subscription.unsubscribe();
    }
  },
};
