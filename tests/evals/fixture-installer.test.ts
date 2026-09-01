/* Verifies fixture references are resolved through narrow Owner-specific install commands. */
import { describe, expect, it, vi } from 'vitest';
import { EvaluationFixtureSchema } from '../../evals/agent/fixtures/fixture';
import { installFixture, type EvaluationFixtureOwner } from '../../evals/agent/fixtures/install-fixture';

describe('Evaluation Fixture installer', () => {
  it('maps fixture identities to real Owner identities and verifies the result', async () => {
    const owner: EvaluationFixtureOwner = {
      installWorkspace: vi.fn(async () => ({ workspaceId: 'workspace:1' })),
      installSession: vi.fn(async () => ({ sessionId: 'session:1' })),
      installInterest: vi.fn(async () => ({ interestId: 'interest:1' })),
      installCandidate: vi.fn(async (entry) => {
        expect(entry.interestIds).toEqual(['interest:1']);
        return { candidateId: 'candidate:1' };
      }),
      installRecommendation: vi.fn(async (entry) => {
        expect(entry.candidateId).toBe('candidate:1');
        return { recommendationId: 'recommendation:1' };
      }),
      installPreference: vi.fn(async (entry) => {
        expect(entry.recommendationIds).toEqual(['recommendation:1']);
        return { revisionId: 'interest:1:1' };
      }),
      verifyInstalled: vi.fn(async () => undefined),
    };
    const fixture = EvaluationFixtureSchema.parse({
      fixtureId: 'fixture', version: 1, capability: 'daily_recommendation',
      clock: '2026-01-01T00:00:00.000Z', workspace: { rootPath: 'workspace' },
      sessions: [{ fixtureSessionId: 's', title: 'Session', turns: [] }],
      interests: [{ fixtureInterestId: 'i', description: 'Interest' }],
      candidates: [{ fixtureCandidateId: 'c', sourceId: 'open_web', sourceName: 'Web', canonicalUrl: 'https://example.test/c', title: 'Candidate', matchedInterestFixtureIds: ['i'], relevance: 'direct' }],
      recommendations: [{ fixtureRecommendationId: 'r', candidateFixtureId: 'c', reason: 'Relevant' }],
      preferences: [{ scopeKey: 'interest:1', directionId: 'd', polarity: 'positive', dimension: 'topic', statement: 'Prefer topic', supportingRecommendationFixtureIds: ['r'] }],
    });
    const installed = await installFixture(fixture, owner);
    expect(installed.recommendations.r).toBe('recommendation:1');
    expect(owner.verifyInstalled).toHaveBeenCalledOnce();
  });
});

