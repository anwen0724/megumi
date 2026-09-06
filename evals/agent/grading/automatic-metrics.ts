/*
 * Scores only declared deterministic business checks and complete Trace measurements.
 */
import { preferenceSequenceMetric } from './preference-sequence-metrics';
import { readDiscoveryRecordState } from './discovery-record-state';
import type { CaseEvidence } from './record-evidence';
import type { MetricPolicy, MetricResult } from './grading-contract';



/** Computes one metric without interpreting natural-language recommendation quality. */
export function automaticMetric(policy: MetricPolicy, evidence: CaseEvidence): MetricResult {
  const metricId = policy.metricId;
  if (metricId.startsWith('personalization.')) return preferenceSequenceMetric(metricId, evidence);
  const unavailable = (reason: string): MetricResult => ({ metricId, status: 'unavailable', reason });
  if (policy.method === 'measurement') return measurement(policy, evidence);
  if (evidence.result.finalState.status !== 'captured') return unavailable('Final business facts were not captured.');
  const initial = readDiscoveryRecordState(evidence.initialState, evidence.result.schemaVersion);
  const final = readDiscoveryRecordState(evidence.result.finalState, evidence.result.schemaVersion);
  if (!initial.success || !final.success) return unavailable('Discovery state is missing or invalid.');
  const before = initial.data;
  const after = final.data;
  if (metricId.startsWith('recommendation.')) {
    const previousIds = new Set(before.recommendations.map(({ id }) => id));
    const added = after.recommendations.filter(({ id }) => !previousIds.has(id));
    if (metricId === 'recommendation.novelty') {
      const identities = new Set(before.recommendations.map(({ contentIdentity }) => contentIdentity));
      let valid = 0;
      for (const item of added) { if (!identities.has(item.contentIdentity)) valid++; identities.add(item.contentIdentity); }
      return ratio(metricId, valid, added.length, 'New recommendations compared with all historical and current content identities.');
    }
    let valid = 0;
    for (const item of added) {
      if (after.candidates.some((candidate) => candidate.id === item.candidateId && candidate.status === 'consumed' && candidate.contentIdentity === item.contentIdentity)) valid++;
      if (after.recommendationContents.filter((content) => content.recommendationId === item.id).length === 1) valid++;
      if (after.recommendationStates.filter((state) => state.recommendationId === item.id).length === 1) valid++;
    }
    return ratio(metricId, valid, added.length * 3, 'Consumed matching Candidate, one content snapshot and one user state per new recommendation.');
  }
  if (evidence.snapshot.case.type !== 'preference_learning') return unavailable('Expected a Preference Case.');
  const expected = evidence.snapshot.case.expected;
  const declaredIds = [...(expected?.retractedDirectionIds ?? []), ...(expected?.retainedDirectionIds ?? [])];
  if (new Set(declaredIds).size !== declaredIds.length || declaredIds.some((id) => !before.preferences.some((entry) => entry.id === id))) {
    return unavailable('Declared Preference IDs must be distinct and present in initial facts.');
  }
  if (metricId === 'preference.retraction_effectiveness') {
    if (evidence.result.schemaVersion !== 3) return unavailable('Effective-read semantics require record version 3.');
    const ids = expected?.retractedDirectionIds ?? [];
    return ratio(metricId, ids.filter((id) => !after.preferences.some((p) => p.id === id && p.status === 'active')).length, ids.length, 'Retracted judgments must be inactive; the original record may remain.');
  }
  if (metricId === 'preference.retraction_correctness') {
    if (evidence.result.schemaVersion !== 2) return unavailable('Physical deletion semantics apply only to legacy version 2 records.');
    const ids = expected?.retractedDirectionIds ?? [];
    return ratio(metricId, ids.filter((id) => !after.preferences.some((entry) => entry.id === id)).length, ids.length,
      'Declared retracted Preference IDs must be absent from final facts.');
  }
  const ids = expected?.retainedDirectionIds ?? [];
  const valid = ids.filter((id) => after.preferences.some((preference) => preference.id === id)
    && after.preferenceEvidence.some((support) => support.preferenceId === id
      && after.recommendationStates.some((state) => state.recommendationId === support.recommendationId
        && state.reaction === support.reaction && state.reactionRevision === support.reactionRevision)));
  return ratio(metricId, valid.length, ids.length, 'Declared retained Preferences must retain at least one current supporting reaction.');
}
/** Excludes absent denominators rather than producing a misleading perfect score. */
function ratio(metricId: string, numerator: number, denominator: number, reason: string): MetricResult {
  return denominator > 0
    ? { metricId, status: 'scored', numerator, denominator, value: numerator / denominator, reason }
    : { metricId, status: 'not_applicable', reason: 'No declared or observed objects for this metric.' };
}

/** Uses the complete business Trace span and all attempts; missing usage never becomes zero. */
function measurement(policy: MetricPolicy, evidence: CaseEvidence): MetricResult {
  const metricId = policy.metricId;
  const unavailable = (reason: string): MetricResult => ({ metricId, status: 'unavailable', reason });
  if (evidence.result.traceIntegrity.status !== 'complete' || evidence.traceError || !evidence.traceMetrics.length) {
    return unavailable(evidence.traceError ?? 'Complete business Trace evidence is required.');
  }
  if (evidence.traces.some((trace) => trace.diagnostics === 'incomplete')) return unavailable('Trace diagnostics are incomplete.');
  const measures = evidence.traceMetrics;
  let value: number;
  if (metricId === 'efficiency.input_tokens' || metricId === 'efficiency.output_tokens') {
    // A scheduled retry may have consumed tokens before an unrecorded failed response.
    if (measures.some((item) => item.issues.length > 0 || item.retries > 0)) return unavailable('Token usage is incomplete or retry usage cannot be verified.');
    value = measures.reduce((sum, item) => sum + (metricId === 'efficiency.input_tokens' ? item.usage.inputTokens : item.usage.outputTokens), 0);
  } else if (metricId === 'efficiency.duration_ms') {
    const intervals = evidence.traces.map((trace) => ({ start: Date.parse(trace.startedAt ?? ''), end: Date.parse(trace.endedAt ?? '') }));
    if (intervals.some(({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || end < start)) return unavailable('Trace start/end timestamps are missing or invalid.');
    value = Math.max(...intervals.map(({ end }) => end)) - Math.min(...intervals.map(({ start }) => start));
  } else {
    const key = metricId === 'efficiency.model_calls' ? 'modelCalls'
      : metricId === 'efficiency.tool_calls' ? 'toolCalls'
      : metricId === 'efficiency.source_calls' ? 'sourceCalls' : 'retries';
    value = measures.reduce((sum, item) => sum + item[key], 0);
  }
  return { metricId, status: 'scored', value, reason: 'Derived from all archived business Trace records; no model execution.' };
}
