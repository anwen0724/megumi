/* Reports shared learning and paired recommendation costs without counting shared work twice. */
import { PreferenceSequenceRecordSchema, type SequenceTrace } from '../contracts/preference-sequence-record';
import type { CaseEvidence } from './record-evidence';

/** Derives cost views only from sealed measurements; missing usage remains unavailable. */
export function preferenceSequenceCosts(evidence: readonly CaseEvidence[]) {
  return evidence.flatMap((entry) => {
    if (entry.snapshot.case.type !== 'preference_sequence') return [];
    const parsed = PreferenceSequenceRecordSchema.safeParse(entry.result.ownerFacts);
    if (!parsed.success) return [{ caseIdentity: entry.snapshot.identity, status: 'unavailable', checkpoints: [] }];
    return [{ caseIdentity: entry.snapshot.identity, status: 'captured', checkpoints: parsed.data.steps
      .filter((step) => step.input.kind === 'recommend').map((step) => ({
        checkpointId: step.stepId,
        // Main-step traces already include shared learning and the learned arm once.
        mainPath: summarize(step.traces),
        sharedLearning: summarize(step.traces.filter((trace) => trace.kind === 'preference_learning'
          && !step.experiments.some((arm) => arm.traces.some((other) => other.traceId === trace.traceId)))),
        recommendations: step.experiments.map((arm) => ({ arm: arm.arm,
          cost: summarize(arm.traces.filter((trace) => trace.kind === 'recommendation')),
          unexpectedLearning: summarize(arm.traces.filter((trace) => trace.kind === 'preference_learning')),
        })),
      })) }];
  });
}

function summarize(traces: readonly SequenceTrace[]) {
  const unique = [...new Map(traces.map((trace) => [trace.traceId, trace])).values()];
  const measurements = unique.flatMap((trace) => trace.measurements ? [trace.measurements] : []);
  const complete = measurements.length === unique.length;
  const usageAvailable = complete && measurements.every((item) => item.issues.length === 0 && item.diagnostics === 'complete');
  const usage = usageAvailable ? measurements.reduce((total, item) => ({
    inputTokens: total.inputTokens + item.usage.inputTokens,
    outputTokens: total.outputTokens + item.usage.outputTokens,
    cacheReadTokens: total.cacheReadTokens + item.usage.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + item.usage.cacheWriteTokens,
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }) : null;
  return { traceIds: unique.map((trace) => trace.traceId),
    modelCalls: complete ? measurements.reduce((sum, item) => sum + item.modelCalls, 0) : null,
    retries: complete ? measurements.reduce((sum, item) => sum + item.retries, 0) : null,
    // Sum of measured Trace durations, not total sequence wall time.
    traceDurationMs: complete && measurements.every((item) => item.durationMs !== undefined)
      ? measurements.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) : null,
    usage,
  };
}
