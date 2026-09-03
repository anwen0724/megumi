/* Verifies Recommendation ranks the complete eligible snapshot without a hidden Candidate window. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  rankRecommendationCandidates,
  type RecommendationCandidate,
  type RecommendationHistoryItem,
} from '@megumi/discovery';

const snapshotAt = '2026-08-27T08:00:00.000Z';

describe('Recommendation ranking', () => {
  it('ranks every eligible Candidate before deriving the configured working set', () => {
    const candidates = Array.from({ length: 200 }, (_, index) => candidate({
      id: `candidate:${String(index).padStart(3, '0')}`,
      interestId: `interest:${index % 4}`,
      sourceId: `source:${index % 5}`,
      contentType: index % 2 === 0 ? 'article' : 'video',
      createdAt: `2026-08-${String((index % 20) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));

    const ranked = rankRecommendationCandidates({
      snapshotAt,
      targetCount: 20,
      workingSetCount: 80,
      candidates,
      history: [],
    });

    expect(ranked.eligibleCount).toBe(200);
    expect(ranked.actualTargetCount).toBe(20);
    expect(ranked.rankedCandidates).toHaveLength(200);
    expect(ranked.initialWorkingSet).toEqual(ranked.rankedCandidates.slice(0, 80));
    expect(new Set(ranked.rankedCandidates.map(({ candidate }) => candidate.id)).size).toBe(200);
  });

  it('filters only objective eligibility failures and derives the actual target', () => {
    const valid = candidate({ id: 'candidate:valid', interestId: 'interest:1' });
    const ranked = rankRecommendationCandidates({
      snapshotAt,
      targetCount: 5,
      workingSetCount: 10,
      candidates: [
        valid,
        candidate({ id: 'candidate:consumed', interestId: 'interest:1', status: 'consumed' }),
        candidate({ id: 'candidate:expired', interestId: 'interest:1', expiresAt: snapshotAt }),
        candidate({ id: 'candidate:unmatched', interestId: undefined }),
        candidate({ id: 'candidate:recommended', interestId: 'interest:1' }),
      ],
      history: [history('candidate:recommended', 'identity:candidate:recommended', 'interest:1')],
    });

    expect(ranked.actualTargetCount).toBe(1);
    expect(ranked.rankedCandidates.map(({ candidate }) => candidate.id)).toEqual([valid.candidate.id]);
    expect(ranked.exclusions.map(({ candidateId, reason }) => ({ candidateId, reason }))).toEqual([
      { candidateId: 'candidate:consumed', reason: 'not_available' },
      { candidateId: 'candidate:expired', reason: 'expired' },
      { candidateId: 'candidate:unmatched', reason: 'no_active_interest_match' },
      { candidateId: 'candidate:recommended', reason: 'already_recommended' },
    ]);
  });

  it('balances current Interest, Source, and Content Type coverage with stable tie breaking', () => {
    const ranked = rankRecommendationCandidates({
      snapshotAt,
      targetCount: 3,
      workingSetCount: 4,
      candidates: [
        candidate({ id: 'a-article-1', interestId: 'interest:a', sourceId: 'source:1', contentType: 'article' }),
        candidate({ id: 'a-article-2', interestId: 'interest:a', sourceId: 'source:1', contentType: 'article' }),
        candidate({ id: 'b-video', interestId: 'interest:b', sourceId: 'source:2', contentType: 'video' }),
        candidate({ id: 'c-post', interestId: 'interest:c', sourceId: 'source:3', contentType: 'post' }),
      ],
      history: [
        history('old:a', 'identity:old:a', 'interest:a', 'source:1', 'article'),
        history('old:b', 'identity:old:b', 'interest:b', 'source:2', 'video'),
      ],
    });

    expect(ranked.rankedCandidates.map(({ candidate }) => candidate.id)).toEqual([
      'c-post',
      'a-article-1',
      'b-video',
      'a-article-2',
    ]);
    expect(ranked.rankedCandidates.map(({ rank }) => rank)).toEqual([0, 1, 2, 3]);
  });

  it('keeps direct before adjacent before exploration and resolves ties deterministically', () => {
    const ranked = rankRecommendationCandidates({
      snapshotAt,
      targetCount: 2,
      workingSetCount: 4,
      candidates: [
        candidate({ id: 'exploration', interestId: 'interest:a', relevance: 'exploration' }),
        candidate({ id: 'adjacent', interestId: 'interest:b', relevance: 'adjacent' }),
        candidate({ id: 'direct-b', interestId: 'interest:b', relevance: 'direct' }),
        candidate({ id: 'direct-a', interestId: 'interest:a', relevance: 'direct' }),
      ],
      history: [],
    });

    expect(ranked.rankedCandidates.map(({ candidate }) => candidate.id)).toEqual([
      'direct-a', 'direct-b', 'adjacent', 'exploration',
    ]);
  });

  it('excludes a content identity that was recommended before the 30-day ranking window', () => {
    const duplicate = candidate({ id: 'candidate:new', interestId: 'interest:a' });
    const ranked = rankRecommendationCandidates({
      snapshotAt,
      targetCount: 1,
      workingSetCount: 1,
      candidates: [duplicate],
      history: [{
        ...history('candidate:old', duplicate.candidate.contentIdentity, 'interest:a'),
        publishedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    expect(ranked.rankedCandidates).toEqual([]);
    expect(ranked.exclusions).toEqual([{
      candidateId: 'candidate:new', reason: 'already_recommended',
    }]);
  });
});

function candidate(input: {
  readonly id: string;
  readonly interestId?: string;
  readonly relevance?: 'direct' | 'adjacent' | 'exploration';
  readonly sourceId?: string;
  readonly contentType?: RecommendationCandidate['candidate']['contentType'];
  readonly status?: RecommendationCandidate['candidate']['status'];
  readonly createdAt?: string;
  readonly expiresAt?: string;
}): RecommendationCandidate {
  return {
    candidate: {
      id: input.id,
      contentIdentity: `identity:${input.id}`,
      sourceId: input.sourceId ?? 'source:default',
      canonicalUrl: `https://example.com/${input.id}`,
      contentType: input.contentType ?? 'article',
      title: input.id,
      contentSummary: `${input.id} summary`,
      contentTruncated: false,
      status: input.status ?? 'available',
      createdAt: input.createdAt ?? '2026-08-20T00:00:00.000Z',
      expiresAt: input.expiresAt ?? '2026-09-20T00:00:00.000Z',
    },
    sourceName: input.sourceId ?? 'source:default',
    interestMatches: input.interestId ? [{
      id: `match:${input.id}`,
      candidateId: input.id,
      interestId: input.interestId,
      relevance: input.relevance ?? 'direct',
      matchReason: `${input.id} matches ${input.interestId}`,
    }] : [],
  };
}

function history(
  candidateId: string,
  contentIdentity: string,
  interestId: string,
  sourceId = 'source:history',
  contentType = 'article',
): RecommendationHistoryItem {
  return {
    recommendationId: `recommendation:${candidateId}`,
    candidateId,
    contentIdentity,
    sourceId,
    contentType,
    matchedInterestIds: [interestId],
    publishedAt: '2026-08-26T00:00:00.000Z',
  };
}
