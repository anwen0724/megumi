/* Owns the recommendation discussion responsibility of the Recommendation product. */
import type { Recommendation } from './daily/publish-recommendations';

export interface RecommendationReferenceContent {
  readonly type: 'recommendation_reference';
  readonly recommendationId: string;
  readonly sourceName: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly description?: string;
  readonly coverUrl?: string;
  readonly recommendationReason: string;
}


export type RecommendationDiscussionResult =
  | { readonly status: 'resolved'; readonly reference: RecommendationReferenceContent; }
  | {
    readonly status: 'rejected'; readonly error: {
      readonly code: 'RECOMMENDATION_REQUIRES_NEW_SESSION' | 'RECOMMENDATION_NOT_FOUND' | 'RECOMMENDATION_REFERENCE_INVALID';
      readonly message: string;
    }
   };

/** Validates product association before passing immutable reference content to the Coding product. */
export function resolveRecommendationDiscussion(
  request: { readonly recommendationId: string; readonly sessionId?: string; },
  recommendations: { getRecommendationReference(id: string): RecommendationReferenceContent | undefined; },
): RecommendationDiscussionResult {
  if (request.sessionId) return {
    status: 'rejected', error: {
      code: 'RECOMMENDATION_REQUIRES_NEW_SESSION', message: 'A Recommendation can only start a new Session.',
    }
  };
  try {
    const reference = recommendations.getRecommendationReference(request.recommendationId);
    return reference ? { status: 'resolved', reference: structuredClone(reference) } : {
      status: 'rejected', error: {
        code: 'RECOMMENDATION_NOT_FOUND', message: 'The Recommendation is missing, hidden, or not published.',
      }
    };
  } catch {
    return {
      status: 'rejected', error: {
        code: 'RECOMMENDATION_REFERENCE_INVALID', message: 'The Recommendation reference is invalid.',
      }
    };
  }
}

/** Projects a published recommendation into immutable conversation input. */
export function recommendationReference(item: Recommendation): RecommendationReferenceContent {
  return {
    type: 'recommendation_reference',
    recommendationId: item.id,
    sourceName: item.content.sourceName,
    canonicalUrl: item.content.canonicalUrl,
    title: item.content.title,
    ...(item.content.author ? { author: item.content.author } : {}),
    ...(item.content.contentPublishedAt ? { publishedAt: item.content.contentPublishedAt } : {}),
    ...(item.content.description ? { description: item.content.description } : {}),
    ...(item.content.coverUrl ? { coverUrl: item.content.coverUrl } : {}),
    recommendationReason: item.recommendationReason,
  };
}
