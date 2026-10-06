/* Builds model-visible preference facts from the product-owned feedback snapshot. */
import {
  buildSystemPrompt,
  loadSystemInstructionDocuments,
  type PreparedContext,
} from '@megumi/agent';
import type { PreferenceLearningFacts, PreferenceSetDetail } from './preference-rules';

/** Includes effective preference text and its source evidence without storage handles. */
export function contextPreference(snapshot: PreferenceSetDetail) {
  return {
    preferenceSetId: snapshot.preferenceSet.id,
    scope: snapshot.preferenceSet.scope,
    ...(snapshot.preferenceSet.interestId ? { interestId: snapshot.preferenceSet.interestId } : {}),
    revision: snapshot.preferenceSet.revision,
    preferences: snapshot.preferences.map(({ preference, evidence }) => ({
      id: preference.id,
      ...(preference.polarity ? { polarity: preference.polarity } : {}),
      ...(preference.dimension ? { dimension: preference.dimension } : {}),
      origin: preference.origin,
      status: preference.status,
      revision: preference.revision,
      ...(preference.userEditedAt ? { userEditedAt: preference.userEditedAt } : {}),
      ...(preference.deletedFeedbackSequence !== undefined
        ? { deletedFeedbackSequence: preference.deletedFeedbackSequence }
        : {}),
      evidence,
      statement: preference.statement,
      updatedAt: preference.updatedAt,
      supportingRecommendationIds: evidence.map(({ recommendationId }) => recommendationId),
    })),
  };
}

/** Loads instructions and projects the supplied feedback batch without another owner lookup. */
export async function preparePreferenceContext(request: {
  readonly facts: PreferenceLearningFacts;
  readonly instructionDocuments: readonly { instructionId: string; sourcePath: string }[];
  readonly signal: AbortSignal;
}): Promise<PreparedContext> {
  const documents = await loadSystemInstructionDocuments({
    documents: request.instructionDocuments,
    signal: request.signal,
  });
  request.signal.throwIfAborted();
  const material = preferenceFacts(request.facts);
  return {
    systemPrompt: buildSystemPrompt({ systemInstructions: documents, tools: [] }),
    messages: [
      {
        role: 'user',
        content: JSON.stringify(material),
        timestamp: Date.parse(request.facts.batch.startedAt),
      },
    ],
    tools: [],
  };
}

function preferenceFacts(facts: PreferenceLearningFacts) {
  const interests = facts.interests;
  const contextFacts = {
    batch: {
      batchId: facts.batch.batchId,
      startedAt: facts.batch.startedAt,
      changeCount: facts.batch.changeCount,
    },
    interests: interests.map((interest) => ({
      interestId: interest.id,
      description: interest.description,
      status: interest.status,
      revision: interest.revision,
      ...(interest.descriptionUserEditedAt
        ? { descriptionUserEditedAt: interest.descriptionUserEditedAt }
        : {}),
    })),
    currentPreferences: facts.currentPreferences.map(contextPreference),
    supportingReactions: facts.supportingReactions,
    reviewedPreferenceIds: facts.reviewedPreferenceIds,
    allowAdd: facts.allowAdd,
    reactionChanges: facts.reactionChanges.map((change) => ({
      recommendationId: change.recommendationId,
      ...(change.learnedReaction ? { learnedReaction: change.learnedReaction } : {}),
      learnedReactionRevision: change.learnedReactionRevision,
      ...(change.currentReaction ? { currentReaction: change.currentReaction } : {}),
      currentReactionRevision: change.currentReactionRevision,
      changedAt: change.changedAt,
      requiresCorrection: change.requiresCorrection,
      recommendation: {
        title: change.recommendation.title,
        sourceName: change.recommendation.sourceName,
        ...(change.recommendation.author ? { author: change.recommendation.author } : {}),
        contentType: change.recommendation.contentType,
        publishedAt: change.recommendation.publishedAt,
        recommendationReason: change.recommendation.recommendationReason,
        matchedInterestIds: change.recommendation.matchedInterestIds,
        contentEvidence: { ...change.recommendation.contentEvidence },
      },
      previouslySupportedPreferenceIds: change.previouslySupportedPreferenceIds,
    })),
  };
  return contextFacts;
}
