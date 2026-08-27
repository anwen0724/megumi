/* Verifies the deterministic Candidate Pool window presented to Daily Recommendation. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildDailyCandidateWindow,
  type DailyRecommendationCandidate,
} from '@megumi/discovery';

const now = '2026-08-27T08:00:00.000Z';

describe('Daily Recommendation Candidate window', () => {
  it('derives the actual target from the current setting and eligible Pool size', () => {
    const result = buildDailyCandidateWindow({
      now,
      requestedCount: 5,
      activeInterestIds: ['interest:1'],
      candidates: [
        candidate('candidate:1', 'direct', ['interest:1'], '2026-08-25T00:00:00.000Z'),
        candidate('candidate:2', 'adjacent', ['interest:1'], '2026-08-26T00:00:00.000Z'),
        candidate('candidate:consumed', 'direct', ['interest:1'], '2026-08-24T00:00:00.000Z', {
          status: 'consumed',
        }),
        candidate('candidate:expired', 'direct', ['interest:1'], '2026-08-23T00:00:00.000Z', {
          expiresAt: '2026-08-27T07:59:59.000Z',
        }),
      ],
    });

    expect(result).toMatchObject({ availableCount: 2, requestedCount: 5, actualTarget: 2, windowLimit: 2 });
    expect(result.candidates.map(({ candidateId }) => candidateId)).toEqual(['candidate:1', 'candidate:2']);
  });

  it('round-robins active Interests and gives exploration Candidates a non-tail lane', () => {
    const result = buildDailyCandidateWindow({
      now,
      requestedCount: 2,
      activeInterestIds: ['interest:a', 'interest:b'],
      candidates: [
        candidate('a-adjacent', 'adjacent', ['interest:a'], '2026-08-20T00:00:00.000Z'),
        candidate('a-direct-new', 'direct', ['interest:a'], '2026-08-22T00:00:00.000Z'),
        candidate('a-direct-old', 'direct', ['interest:a'], '2026-08-21T00:00:00.000Z'),
        candidate('b-adjacent', 'adjacent', ['interest:b'], '2026-08-20T00:00:00.000Z'),
        candidate('b-direct', 'direct', ['interest:b'], '2026-08-23T00:00:00.000Z'),
        candidate('explore-new', 'exploration', [], '2026-08-25T00:00:00.000Z'),
        candidate('explore-old', 'exploration', [], '2026-08-24T00:00:00.000Z'),
      ],
    });

    expect(result.candidates.map(({ candidateId }) => candidateId)).toEqual([
      'a-direct-old',
      'b-direct',
      'explore-old',
      'a-direct-new',
      'b-adjacent',
      'explore-new',
      'a-adjacent',
    ]);
  });

  it('caps the representative window at max three times the dynamic target or forty', () => {
    const candidates = Array.from({ length: 45 }, (_, index) => candidate(
      `candidate:${String(index).padStart(2, '0')}`,
      'direct',
      ['interest:1'],
      `2026-08-${String((index % 20) + 1).padStart(2, '0')}T00:00:00.000Z`,
    ));

    const result = buildDailyCandidateWindow({
      now,
      requestedCount: 2,
      activeInterestIds: ['interest:1'],
      candidates,
    });

    expect(result).toMatchObject({ availableCount: 45, actualTarget: 2, windowLimit: 40 });
    expect(result.candidates).toHaveLength(40);
  });
});

function candidate(
  candidateId: string,
  relevance: DailyRecommendationCandidate['admission']['relevance'],
  matchedInterestIds: readonly string[],
  statusUpdatedAt: string,
  overrides: Partial<DailyRecommendationCandidate> = {},
): DailyRecommendationCandidate {
  return {
    candidateId,
    contentIdentity: `identity:${candidateId}`,
    status: 'available',
    primarySourceId: 'open_web',
    primarySourceName: 'example.com',
    canonicalUrl: `https://example.com/${candidateId}`,
    contentType: 'article',
    title: candidateId,
    description: `${candidateId} description`,
    firstSeenAt: '2026-08-20T00:00:00.000Z',
    lastSeenAt: '2026-08-26T00:00:00.000Z',
    expiresAt: '2026-09-01T00:00:00.000Z',
    statusUpdatedAt,
    admission: {
      relevance,
      matchedInterestIds,
      reason: `${candidateId} admission`,
    },
    ...overrides,
  };
}
