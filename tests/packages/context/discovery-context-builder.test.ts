/* Verifies Discovery Context resolvers own business-fact reads for every model call. */
import { describe, expect, it, vi } from 'vitest';
import { createContext } from '../../../packages/agent/context/src';
import { completedMessage, model, workspaceSource } from './context-test-fixtures';

function options() {
  const readRecommendationFacts = vi.fn(async () => ({
    status: 'ok' as const,
    facts: {
      asOf: '2026-08-27T08:00:00.000Z',
      execution: {
        requestId: 'request:1', localDate: '2026-08-27',
        actualTarget: 1, eligibleCount: 1, workingSetCount: 1,
      },
      interests: [{
        interestId: 'interest:1', description: 'Agent architecture', interestRevision: 1,
        preference: {
          scopeKey: 'interest:interest:1', scope: 'interest' as const,
          interestId: 'interest:1', revision: 0, directions: [],
        },
      }],
      preferences: [{
        scopeKey: 'exploration', scope: 'exploration' as const, revision: 1,
        directions: [{
          directionId: 'direction:exploration', polarity: 'positive' as const,
          dimension: 'topic' as const, statement: 'Prefer local-first system design.',
          supportingRecommendationIds: ['recommendation:exploration'], updatedAt: '2026-08-27T07:00:00.000Z',
        }],
      }],
      candidates: [{
        candidateId: 'candidate:1', contentIdentity: 'identity:1', sourceName: 'Example',
        canonicalUrl: 'https://example.com/agent', contentType: 'article', title: 'Agent guide',
        contentSummary: 'A grounded Candidate summary.',
        contentExcerpt: 'Original Source evidence.',
        contentTruncated: false,
        matchedInterestIds: ['interest:1'],
        interestMatches: [{
          interestId: 'interest:1', relevance: 'direct' as const,
          matchReason: 'Related to the active Interest.',
        }],
      }],
      recentRecommendations: [],
      ranking: [{ candidateId: 'candidate:1', eligible: true, rank: 0, relevanceRank: 0 }],
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
        { instructionId: 'megumi.recommendation', sourcePath: '/recommendation.md', content: 'recommendation' },
      ]),
      getEffectiveInstructions: vi.fn(),
    },
    skills: { createView: vi.fn() },
    models: { completeSimple: vi.fn(async () => completedMessage()) },
    discoveryFactsReader: {
      readCandidateSupplyFacts: vi.fn(),
      readRecommendationFacts,
      readPreferenceLearningFacts: vi.fn(),
    },
    discoverySourceRegistry: { listContextSources: vi.fn(() => []) },
  };
}

describe('Discovery Context ownership', () => {
  it('reads Recommendation facts inside Context instead of accepting Runtime material', async () => {
    const dependencies = options();
    const result = await createContext(dependencies).build({
      modelCallContext: {
        modelCallId: 'model-call:1',
        run: {
          kind: 'recommendation', executionId: 'execution:1', requestId: 'request:1',
          localDate: '2026-08-27', model,
        },
        tools: [],
      },
      currentMessages: [],
    });

    expect(dependencies.discoveryFactsReader.readRecommendationFacts).toHaveBeenCalledWith({
      executionId: 'execution:1', requestId: 'request:1', localDate: '2026-08-27', signal: undefined,
    });
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status === 'ready') {
      expect(result.prompt.systemPrompt).toContain('Agent guide');
      expect(result.prompt.systemPrompt).toContain('Prefer local-first system design.');
    }
  });

  it('places Candidate Supply execution material in the task message instead of System', async () => {
    const dependencies = options();
    dependencies.instructionReader.getSystemInstructions.mockResolvedValue([
      { instructionId: 'megumi.common', sourcePath: '/common.md', content: 'common' },
      { instructionId: 'megumi.candidate-supply', sourcePath: '/candidate.md', content: 'candidate' },
    ]);
    dependencies.discoveryFactsReader.readCandidateSupplyFacts.mockResolvedValue({
      status: 'ok',
      facts: {
        asOf: '2026-08-27T08:00:00.000Z',
        executionId: 'execution:supply',
        startedAt: '2026-08-27T08:00:00.000Z',
        trigger: 'startup',
        pool: {
          minimumCount: 100, targetCount: 160, maximumCount: 200,
          availableCount: 80, minimumShortfall: 20, targetShortfall: 80,
          availableByInterest: { 'interest:1': 80 },
        },
        sourceIds: ['open_web'],
        interests: [{
          interestId: 'interest:1', description: 'Agent architecture', interestRevision: 1,
        }],
      },
    });
    dependencies.discoverySourceRegistry.listContextSources.mockReturnValue([{
      sourceId: 'open_web', name: 'Open Web', access: 'public',
      supportedModes: ['relevance', 'recent'], supportsRead: true, availability: 'ready',
    }]);
    const candidateTools = [{
      name: 'search_content', description: 'Search content.', promptSnippet: 'Search content.',
      parameters: { type: 'object' },
    }];
    const result = await createContext(dependencies).build({
      modelCallContext: {
        modelCallId: 'model-call:supply',
        run: {
          kind: 'candidate_supply', executionId: 'execution:supply', requestId: 'request:1',
          startedAt: '2026-08-27T08:00:00.000Z', trigger: 'startup', model,
        },
        tools: candidateTools,
      },
      currentMessages: [{
        role: 'user', content: '开始本次 Candidate Supply 执行。', timestamp: 1,
      }],
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.prompt.systemPrompt).toContain('common\n\ncandidate');
    expect(result.prompt.systemPrompt).not.toContain('<candidate_supply_material>');
    expect(result.prompt.systemPrompt).not.toContain('<available_tools>');
    expect(result.prompt.messages).toHaveLength(1);
    expect(result.prompt.messages[0]).toMatchObject({ role: 'user', timestamp: 1 });
    expect(result.prompt.messages[0]?.content).toContain('Execute the following Candidate Supply task.');
    expect(result.prompt.messages[0]?.content).toContain('<candidate_supply_material>');
    expect(result.prompt.messages[0]?.content).toContain('"targetShortfall":80');
    expect(result.prompt.messages[0]?.content).toContain('"sourceId":"open_web"');
    expect(result.prompt.tools).toEqual(candidateTools);
  });
});
