/* Verifies Scenario references are resolved through narrow Owner-specific install commands. */
import { describe, expect, it, vi } from 'vitest';
import { EvaluationScenarioSchema } from '../../evals/agent/contracts/evaluation-task';
import {
  installScenario,
  type EvaluationScenarioOwner,
} from '../../evals/agent/runtime/scenario-installer';

describe('Evaluation Scenario installer', () => {
  it('maps Scenario identities to real Owner identities and verifies the result', async () => {
    const owner: EvaluationScenarioOwner = {
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
    const scenario = EvaluationScenarioSchema.parse({
      clock: '2026-01-01T00:00:00.000Z',
      workspace: { files: [] },
      sessions: [{ scenarioSessionId: 's', title: 'Session', turns: [] }],
      interests: [{ scenarioInterestId: 'i', description: 'Interest' }],
      candidates: [{
        scenarioCandidateId: 'c',
        sourceId: 'open_web',
        sourceName: 'Web',
        canonicalUrl: 'https://example.test/c',
        title: 'Candidate',
        matchedInterestScenarioIds: ['i'],
        relevance: 'direct',
      }],
      recommendations: [{
        scenarioRecommendationId: 'r',
        candidateScenarioId: 'c',
        reason: 'Relevant',
      }],
      preferences: [{
        scopeKey: 'interest:1',
        directionId: 'd',
        polarity: 'positive',
        dimension: 'topic',
        statement: 'Prefer topic',
        supportingRecommendationScenarioIds: ['r'],
      }],
    });
    const installed = await installScenario({ scenario, workspaceRoot: 'workspace', owner });
    expect(installed.recommendations.r).toBe('recommendation:1');
    expect(owner.verifyInstalled).toHaveBeenCalledOnce();
  });
});
