/* Resolves the product association required to begin a discussion of a published recommendation. */
import type { RecommendationReferenceContent } from './recommendation-repository';

export type RecommendationDiscussionResult =
  | { readonly status: 'resolved'; readonly reference: RecommendationReferenceContent }
  | { readonly status: 'rejected'; readonly error: {
      readonly code: 'RECOMMENDATION_REQUIRES_NEW_SESSION' | 'RECOMMENDATION_NOT_FOUND' | 'RECOMMENDATION_REFERENCE_INVALID';
      readonly message: string;
    } };

/** Validates product association before passing immutable reference content to the runtime. */
export function resolveRecommendationDiscussion(
  request: { readonly recommendationId: string; readonly sessionId?: string },
  recommendations: { getRecommendationReference(id: string): RecommendationReferenceContent | undefined },
): RecommendationDiscussionResult {
  if (request.sessionId) return { status: 'rejected', error: {
    code: 'RECOMMENDATION_REQUIRES_NEW_SESSION', message: 'A Recommendation can only start a new Session.',
  } };
  try {
    const reference = recommendations.getRecommendationReference(request.recommendationId);
    return reference ? { status: 'resolved', reference: structuredClone(reference) } : { status: 'rejected', error: {
      code: 'RECOMMENDATION_NOT_FOUND', message: 'The Recommendation is missing, hidden, or not published.',
    } };
  } catch {
    return { status: 'rejected', error: {
      code: 'RECOMMENDATION_REFERENCE_INVALID', message: 'The Recommendation reference is invalid.',
    } };
  }
}
