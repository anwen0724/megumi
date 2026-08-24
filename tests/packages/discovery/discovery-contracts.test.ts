/* Verifies strict owner contracts for Discovery's durable and source-facing facts. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DailyDiscoveryBatchSchema,
  DiscoveryHomeViewSchema,
  InterestSchema,
  RecommendationSchema,
  SourceContentSchema,
  SourceDescriptorSchema,
  UpdateRecommendationStateRequestSchema,
} from '@megumi/discovery';

const now = '2026-08-22T00:00:00.000Z';

describe('Discovery owner contracts', () => {
  it('parses durable Interest, Batch, and Recommendation facts strictly', () => {
    expect(InterestSchema.parse({
      interestId: 'interest:1',
      description: '关注 Agent 工程实践',
      status: 'active',
      createdFrom: 'manual',
      userManagedAt: now,
      createdAt: now,
      updatedAt: now,
    })).toMatchObject({ interestId: 'interest:1', status: 'active' });
    expect(DailyDiscoveryBatchSchema.parse({
      batchId: 'batch:1',
      localDate: '2026-08-22',
      timezone: 'Asia/Shanghai',
      status: 'running',
      executionId: 'execution:1',
      targetCount: 20,
      attemptCount: 1,
      automaticRetryCount: 0,
      resultCount: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
    })).toMatchObject({ batchId: 'batch:1', status: 'running' });
    expect(RecommendationSchema.parse(recommendation())).toMatchObject({
      recommendationId: 'recommendation:1',
      sourceId: 'custom_source',
    });

    expect(InterestSchema.safeParse({
      interestId: 'interest:1',
      description: 'valid',
      status: 'active',
      createdFrom: 'manual',
      createdAt: now,
      updatedAt: now,
      extra: true,
    }).success).toBe(false);
  });

  it('keeps source IDs open while validating normalized source content facts', () => {
    expect(SourceDescriptorSchema.parse({
      id: 'youtube',
      name: 'YouTube',
      access: 'public_http',
      supportedModes: ['relevance', 'recent'],
      supportsRead: false,
    })).toEqual({
      id: 'youtube',
      name: 'YouTube',
      access: 'public_http',
      supportedModes: ['relevance', 'recent'],
      supportsRead: false,
    });
    expect(SourceContentSchema.parse({
      sourceId: 'youtube',
      sourceName: 'YouTube',
      sourceContentId: 'video:1',
      canonicalUrl: 'https://youtube.example/video/1',
      contentType: 'video',
      title: 'A video',
      engagement: { viewCount: 0 },
    })).toMatchObject({ sourceId: 'youtube', contentType: 'video' });
    expect(SourceContentSchema.safeParse({
      sourceId: 'youtube',
      sourceName: 'YouTube',
      canonicalUrl: 'file:///tmp/item',
      contentType: 'video',
      title: 'A video',
    }).success).toBe(false);
  });

  it('validates state changes and renderer views without leaking internal fields', () => {
    expect(UpdateRecommendationStateRequestSchema.parse({
      recommendationId: 'recommendation:1',
      action: 'set_reaction',
      reaction: null,
    })).toEqual({
      recommendationId: 'recommendation:1',
      action: 'set_reaction',
      reaction: null,
    });
    expect(DiscoveryHomeViewSchema.parse({
      mode: 'timeline',
      today: {
        localDate: '2026-08-22',
        status: 'not_generated',
        resultCount: 0,
      },
      days: [],
      interests: [],
      favoriteCount: 0,
      watchLaterCount: 0,
    })).toMatchObject({ mode: 'timeline', days: [] });
    expect(RecommendationSchema.safeParse({
      ...recommendation(),
      internalScore: 0.9,
    }).success).toBe(false);
  });
});

function recommendation() {
  return {
    recommendationId: 'recommendation:1',
    batchId: 'batch:1',
    contentIdentity: 'custom_source:item:1',
    position: 0,
    sourceId: 'custom_source',
    sourceName: 'Custom',
    canonicalUrl: 'https://example.com/item/1',
    contentType: 'article',
    title: 'Item',
    recommendationReason: '值得关注。',
    publishedAt: now,
  } as const;
}
