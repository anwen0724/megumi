/* Evaluates one explicitly receipted Candidate Supply check and its durable settlement. */
import type { EvaluationCase } from '../../catalog/evaluation-case';
import { toJsonRecord, type CapabilityEvaluation } from '../../runtime/evidence';

type CandidateSupplyCase = Extract<EvaluationCase, { capability: 'candidate_supply' }>;

export const candidateSupplyEvaluation: CapabilityEvaluation<CandidateSupplyCase> = {
  capability: 'candidate_supply',
  async execute(context) {
    const before = await context.runtime.host.discovery.getConfiguration({});
    const receipt = await context.runtime.host.discovery.requestCandidateSupply({ trigger: 'evaluation' });
    if (!receipt) throw new Error('Candidate Supply did not return a Check receipt.');
    const completion = await context.runtime.host.discovery.waitCandidateSupplyCheck({
      candidateSupplyCheckId: receipt.candidateSupplyCheckId,
      timeoutMs: context.evaluationCase.completion.timeoutMs,
    });
    if (completion.status !== 'completed') throw new Error('Candidate Supply Check did not settle before timeout.');
    const executionId = completion.value.status === 'completed' ? completion.value.executionId : undefined;
    const supplyFacts = executionId
      ? await context.runtime.host.discovery.getCandidateSupplyFacts({ executionId })
      : { status: 'failed' as const, failure: { code: 'no_execution', message: 'The check did not start an Agent Execution.' } };
    const after = await context.runtime.host.discovery.getConfiguration({});
    return {
      input: toJsonRecord(context.evaluationCase.trigger),
      beforeFacts: toJsonRecord({ configuration: before, supplyFacts }),
      completion: toJsonRecord(completion.value),
      afterFacts: toJsonRecord({ configuration: after, supplyFacts }),
      correlation: {
        ...(executionId
          ? { executionId }
          : {}),
      },
      runtimeEvents: [],
    };
  },
};
