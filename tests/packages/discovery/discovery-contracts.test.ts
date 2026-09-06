/* Verifies strict owner contracts for Discovery's durable and source-facing facts. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DiscoveryHomeViewSchema,
  InterestSchema,
  RecommendationContentSchema,
  RecommendationDecisionSchema,
  RecommendationSchema,
  RecommendationStateSchema,
  UpdateRecommendationStateRequestSchema,
  SourceContentSchema,
  SourceDescriptorSchema,
} from '@megumi/discovery';

const now = '2026-08-22T00:00:00.000Z';

describe('Discovery owner contracts', () => {
  it('keeps Recommendation decision, content, and state as three strict records', () => {
    const aggregate = recommendation();
    expect(RecommendationDecisionSchema.parse(decision())).toEqual(decision());
    expect(RecommendationContentSchema.parse(aggregate.content)).toEqual(aggregate.content);
    expect(RecommendationStateSchema.parse(aggregate.state)).toEqual(aggregate.state);
    expect(RecommendationSchema.parse(aggregate)).toEqual(aggregate);
    expect(RecommendationDecisionSchema.safeParse({ ...decision(), title: 'wrong owner' }).success).toBe(false);
  });

  it('parses durable Interest facts strictly', () => {
    expect(InterestSchema.parse({
      id: 'interest:1', revision: 1, description: '关注 Agent 工程实践',
      status: 'active', createdFrom: 'manual', userManagedAt: now, createdAt: now, updatedAt: now,
    })).toMatchObject({ id: 'interest:1', status: 'active' });
    expect(InterestSchema.safeParse({
      id: 'interest:1', revision: 1, description: 'valid', status: 'active',
      createdFrom: 'manual', createdAt: now, updatedAt: now, extra: true,
    }).success).toBe(false);
  });

  it('keeps source IDs open while validating normalized source content facts', () => {
    expect(SourceDescriptorSchema.parse({
      id: 'youtube', name: 'YouTube', access: 'public_http',
      supportedModes: ['relevance', 'recent'], supportsRead: false,
    })).toMatchObject({ id: 'youtube', name: 'YouTube' });
    expect(SourceContentSchema.parse({
      sourceId: 'youtube', sourceName: 'YouTube', sourceContentId: 'video:1',
      canonicalUrl: 'https://youtube.example/video/1', contentType: 'video',
      title: 'A video', engagement: { viewCount: 0 },
    })).toMatchObject({ sourceId: 'youtube', contentType: 'video' });
    expect(SourceContentSchema.safeParse({
      sourceId: 'youtube', sourceName: 'YouTube', canonicalUrl: 'file:///tmp/item',
      contentType: 'video', title: 'A video',
    }).success).toBe(false);
  });

  it('validates state commands and renderer views without leaking internal fields', () => {
    expect(UpdateRecommendationStateRequestSchema.parse({
      recommendationId: 'recommendation:1', action: 'set_reaction', reaction: null,
    })).toEqual({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: null });
    expect(DiscoveryHomeViewSchema.parse({
      candidateSupplyConfirmed: false, candidateSupplyStatus: { status: 'idle' },
      mode: 'timeline', today: { localDate: '2026-08-22', status: 'not_generated', resultCount: 0 },
      days: [], interests: [], favoriteCount: 0, watchLaterCount: 0,
    })).toMatchObject({ mode: 'timeline', days: [] });
    expect(RecommendationSchema.safeParse({ ...recommendation(), internalScore: 0.9 }).success).toBe(false);
  });
});

function decision() {
  return {
    id: 'recommendation:1', candidateId: 'candidate:1', contentIdentity: 'custom:item:1',
    localDate: '2026-08-22', position: 0, recommendationReason: '值得关注。',
    selectionBasis: {
      primaryInterestId: 'interest:1', matchedInterestIds: ['interest:1'],
      interestRevisions: [{ interestId: 'interest:1', revision: 1 }], preferenceRevisions: [],
    },
    publishedAt: now,
  } as const;
}

function recommendation() {
  return {
    ...decision(),
    content: {
      id: 'recommendation-content:1', recommendationId: 'recommendation:1', sourceId: 'custom',
      sourceName: 'Custom', canonicalUrl: 'https://example.com/item/1', contentType: 'article',
      title: 'Item', contentSummary: 'Item summary', contentTruncated: false,
    },
    state: {
      id: 'recommendation-state:1', recommendationId: 'recommendation:1', reactionRevision: 0, reactionSequence: 0,
      learnedReactionRevision: 0, updatedAt: now,
    },
  } as const;
}
