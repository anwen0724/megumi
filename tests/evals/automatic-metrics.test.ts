/*
 * Protects deterministic grading of retraction, retained evidence, and publication facts.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DiscoveryStateSchema } from '@megumi/discovery';
import { loadCase } from '../../evals/agent/datasets/dataset-loader';
import { CaseRunResultSchema } from '../../evals/agent/contracts/evaluation-run';
import { automaticMetric } from '../../evals/agent/grading/automatic-metrics';
import type { CaseEvidence } from '../../evals/agent/grading/record-evidence';

const now = '2026-09-06T00:00:00.000Z';
const empty = () => DiscoveryStateSchema.parse({ interests: [], interestEvidence: [], interestSessionSettings: [], candidates: [], candidateInterestMatches: [],
  recommendations: [], recommendationContents: [], recommendationStates: [], preferenceSets: [], preferences: [], preferenceEvidence: [] });

describe('deterministic evaluation metrics', () => {
  it('rejects a declared retraction that never existed in the initial facts', async () => {
    const evidence = await preferenceEvidence();
    const invalid = { ...evidence, initialState: { facts: { discovery: empty() } } };
    expect(automaticMetric({ metricId: 'preference.retraction_correctness', method: 'rule', direction: 'higher' }, invalid).status).toBe('unavailable');
  });
  it('checks retraction without treating a missing final snapshot as successful deletion', async () => {
    const evidence = await preferenceEvidence();
    const policy = { metricId: 'preference.retraction_correctness', method: 'rule' as const, direction: 'higher' as const };
    expect(automaticMetric(policy, evidence)).toMatchObject({ status: 'scored', value: 1, numerator: 1, denominator: 1 });
    evidence.result.finalState = { status: 'unavailable', message: 'Shutdown failed.' };
    expect(automaticMetric(policy, evidence).status).toBe('unavailable');
  });

  it('requires current surviving support, not just a retained preference row', async () => {
    const evidence = await preferenceEvidence();
    const final = empty();
    final.preferences.push({ id: 'keep', preferenceSetId: 'set', polarity: 'positive', dimension: 'expression_quality', statement: '详细教程', createdAt: now, updatedAt: now });
    final.preferenceEvidence.push({ id: 'support', preferenceId: 'keep', recommendationId: 'rec', reaction: 'liked', reactionRevision: 1, createdAt: now });
    final.recommendationStates.push({ id: 'state', recommendationId: 'rec', reaction: 'liked', reactionRevision: 1, learnedReaction: 'liked', learnedReactionRevision: 1, updatedAt: now });
    evidence.result.finalState = { status: 'captured', facts: { discovery: final } };
    const policy = { metricId: 'preference.evidence_preservation', method: 'rule' as const, direction: 'higher' as const };
    expect(automaticMetric(policy, evidence)).toMatchObject({ status: 'scored', value: 1 });
    final.recommendationStates[0].reactionRevision = 2;
    final.recommendationStates[0].reaction = 'disliked';
    expect(automaticMetric(policy, evidence)).toMatchObject({ status: 'scored', value: 0 });
  });

  it('does not report perfect novelty or integrity when no recommendation was published', async () => {
    const evidence = await preferenceEvidence();
    for (const metricId of ['recommendation.novelty', 'recommendation.publication_integrity']) {
      expect(automaticMetric({ metricId, method: 'rule', direction: 'higher' }, evidence).status).toBe('not_applicable');
    }
  });
});

/** Creates only the immutable facts consumed by the grader, using the production schemas. */
async function preferenceEvidence(): Promise<CaseEvidence> {
  const resolved = await loadCase({ rootDirectory: 'evals/agent/datasets', identity: 'controlled/preference-learning.learn-source-preference' });
  if (resolved.case.type !== 'preference_learning') throw new Error('Expected Preference fixture.');
  resolved.case.expected = { retractedDirectionIds: ['remove'], retainedDirectionIds: ['keep'] };
  const initial = empty();
  for (const id of ['remove', 'keep']) initial.preferences.push({ id, preferenceSetId: 'set', polarity: 'positive', dimension: 'expression_quality', statement: '详细教程', createdAt: now, updatedAt: now });
  const result = CaseRunResultSchema.parse({ schemaVersion: 2, caseRunId: 'case.test', caseIdentity: resolved.identity, caseType: 'preference_learning',
    recordStatus: 'recorded', startedAt: now, endedAt: now, terminalState: 'settled',
    candidateModel: { source: 'explicit', providerId: 'test', modelId: 'test', api: 'test', baseUrl: 'https://example.test', contextWindowTokens: 1000, maxOutputTokens: 100 },
    environment: {}, finalState: { status: 'captured', facts: { discovery: empty() } },
    traceIntegrity: { status: 'complete', traceCount: 0, health: {}, targets: [], issues: [] }, artifacts: { files: [] } });
  return { snapshot: { identity: resolved.identity, environmentKind: 'controlled', revision: resolved.case.revision, digest: resolved.digest,
    resources: {}, datasetMemberships: [], case: resolved.case }, result, initialState: { facts: { discovery: initial } }, evidenceDigest: '0'.repeat(64), traceMetrics: [], traces: [] };
}
