/* Verifies Discovery Context resolvers own business-fact reads for every model call. */
import { describe, expect, it, vi } from 'vitest';
import { createContext } from '../../../packages/agent/context/src';
import { completedMessage, model, workspaceSource } from './context-test-fixtures';

function options() {
  const readDailyRecommendationFacts = vi.fn(async () => ({
    status: 'ok' as const,
    facts: {
      asOf: '2026-08-27T08:00:00.000Z',
      batch: {
        batchId: 'batch:1', localDate: '2026-08-27', requestedCount: 3,
        actualTarget: 1, availableCount: 1, readBudget: 1,
      },
      interests: [{
        interestId: 'interest:1', description: 'Agent architecture', interestRevision: 1,
        preference: {
          scopeKey: 'interest:interest:1', scope: 'interest' as const,
          interestId: 'interest:1', revision: 0, directions: [],
        },
      }],
      explorationPreference: {
        scopeKey: 'exploration', scope: 'exploration' as const, revision: 1,
        directions: [{
          directionId: 'direction:exploration', polarity: 'positive' as const,
          dimension: 'topic' as const, statement: 'Prefer local-first system design.',
          supportingFeedbackIds: ['feedback:exploration'], updatedAt: '2026-08-27T07:00:00.000Z',
        }],
      },
      candidates: [{
        candidateId: 'candidate:1', contentIdentity: 'identity:1', sourceName: 'Example',
        canonicalUrl: 'https://example.com/agent', contentType: 'article', title: 'Agent guide',
        relevance: 'direct' as const, matchedInterestIds: ['interest:1'],
        admissionReason: 'Directly useful.',
        assessmentId: 'assessment:1', assessmentVersion: 'candidate-admission:v1',
        interestRevisions: [{ interestId: 'interest:1', revision: 1 }],
        preferenceRevisions: [],
      }],
      recentRecommendations: [],
      pendingFeedback: [],
      omittedPendingFeedbackCount: 0,
    },
  }));
  return {
    sessionHistory: {
      getActiveHistory: vi.fn(), beginCompaction: vi.fn(), completeCompaction: vi.fn(),
      endCompaction: vi.fn(),
    },
    attachmentReader: { readAttachmentContent: vi.fn() },
    workspaceSource: workspaceSource(),
    instructionReader: {
      getSystemInstructions: vi.fn(async () => [
        { instructionId: 'megumi.daily-recommendation', sourcePath: '/daily.md', content: 'daily' },
      ]),
      getEffectiveInstructions: vi.fn(),
    },
    skills: { createView: vi.fn() },
    models: { completeSimple: vi.fn(async () => completedMessage()) },
    discoveryFactsReader: {
      readCandidateSupplyFacts: vi.fn(),
      readDailyRecommendationFacts,
      readPreferenceLearningFacts: vi.fn(),
    },
    discoverySourceRegistry: { listContextSources: vi.fn(() => []) },
  };
}

describe('Discovery Context ownership', () => {
  it('reads Daily Recommendation facts inside Context instead of accepting Runtime material', async () => {
    const dependencies = options();
    const result = await createContext(dependencies).build({
      modelCallContext: {
        modelCallId: 'model-call:1',
        run: {
          kind: 'daily_recommendation', executionId: 'execution:1', batchId: 'batch:1',
          localDate: '2026-08-27', model,
        },
        tools: [],
      },
      currentMessages: [],
    });

    expect(dependencies.discoveryFactsReader.readDailyRecommendationFacts).toHaveBeenCalledWith({
      executionId: 'execution:1', batchId: 'batch:1', localDate: '2026-08-27', signal: undefined,
    });
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status === 'ready') {
      expect(result.prompt.systemPrompt).toContain('Agent guide');
      expect(result.prompt.systemPrompt).toContain('Prefer local-first system design.');
    }
  });
});
