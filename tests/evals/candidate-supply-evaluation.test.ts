/* Verifies Candidate Supply Evaluation derives every reported metric from replayable facts. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  calculateCandidateSupplyMetrics,
  createReplayDiscoverySource,
  type CandidateSupplyEvaluationFacts,
} from '../../evals/agent/candidate-supply';

describe('Candidate Supply Evaluation', () => {
  it('calculates the complete metric set without hidden mutable counters', () => {
    const facts: CandidateSupplyEvaluationFacts = {
      gap: { initialCount: 4, remainingCount: 1 },
      queries: [
        query({
          status: 'succeeded', rawResultCount: 5, invalidResultCount: 1,
          newCandidateCount: 2, mergedCandidateCount: 2,
          admissionSettled: true, availableCandidateCount: 1,
        }),
        query({
          queryId: 'query:2', status: 'succeeded', rawResultCount: 2,
          newCandidateCount: 1, admissionSettled: true, availableCandidateCount: 0,
        }),
        query({ queryId: 'query:3', status: 'failed' }),
      ],
      assessments: [
        { decision: 'admit' },
        { decision: 'reject', reasonCode: 'semantic_duplicate' },
        { decision: 'reject', reasonCode: 'stale' },
        { decision: 'needs_detail' },
      ],
      candidates: { materializedCount: 4, pendingCount: 1 },
      calls: { model: 3, search: 3, read: 1, admission: 1 },
    };

    expect(calculateCandidateSupplyMetrics(facts)).toEqual({
      gapElimination: ratio(3, 4),
      newCandidateMaterial: ratio(3, 7),
      admission: ratio(1, 3),
      pending: ratio(1, 4),
      rejectionReasons: {
        semantic_duplicate: ratio(1, 2),
        stale: ratio(1, 2),
      },
      semanticDuplicate: ratio(1, 3),
      invalid: ratio(1, 7),
      merge: ratio(2, 6),
      zeroAdmissionQuery: ratio(1, 2),
      sourceFailure: ratio(1, 3),
      calls: { model: 3, search: 3, read: 1, admission: 1 },
    });
  });

  it('uses null instead of inventing a percentage when a metric has no denominator', () => {
    const report = calculateCandidateSupplyMetrics({
      gap: { initialCount: 0, remainingCount: 0 },
      queries: [], assessments: [],
      candidates: { materializedCount: 0, pendingCount: 0 },
      calls: { model: 0, search: 0, read: 0, admission: 0 },
    });

    expect(report.gapElimination).toEqual(ratio(0, 0));
    expect(report.admission.value).toBeNull();
    expect(report.sourceFailure.value).toBeNull();
  });

  it('replays exact Source interactions and fails on an unplanned request', async () => {
    const replay = createReplayDiscoverySource({
      descriptor: {
        id: 'replay', name: 'Replay', access: 'public_http',
        supportedModes: ['relevance'], supportsRead: false,
      },
      searches: [{
        request: { query: 'Agent architecture', mode: 'relevance', limit: 2 },
        result: {
          status: 'success',
          items: [{
            sourceId: 'replay', sourceName: 'Replay', sourceContentId: '1',
            canonicalUrl: 'https://example.com/1', contentType: 'article',
            title: 'Agent architecture', description: 'A concrete architecture analysis.',
          }],
        },
      }],
    });

    const result = await replay.source.search({
      query: 'Agent architecture', mode: 'relevance', limit: 2,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('success');
    expect(replay.calls()).toEqual([
      { operation: 'search', query: 'Agent architecture', mode: 'relevance', limit: 2 },
    ]);
    expect(() => replay.assertExhausted()).not.toThrow();
    await expect(replay.source.search({
      query: 'unexpected', mode: 'relevance', limit: 2,
      signal: new AbortController().signal,
    })).rejects.toThrow('No replay search remains');
  });
});

function query(overrides: Partial<CandidateSupplyEvaluationFacts['queries'][number]> = {}) {
  return {
    queryId: 'query:1', sourceId: 'source:1', status: 'succeeded' as const,
    rawResultCount: 0, invalidResultCount: 0, newCandidateCount: 0,
    mergedCandidateCount: 0, admissionSettled: false, availableCandidateCount: 0,
    ...overrides,
  };
}

function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}
