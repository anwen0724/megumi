/* Resolves authored Case references into existing Discovery entities before runtime startup. */
import { canonicalContentIdentity, normalizeContentUrl, type DiscoveryState } from '@megumi/discovery';
import type { CaseInitialState, InstalledInitialStateIds } from './initial-state';

/** Resolves stable authored IDs and installs only declared business facts. */
export function resolveInitialDiscoveryState(initial: CaseInitialState, ids: InstalledInitialStateIds): DiscoveryState {
  const now = initial.clock;
  const previousDay = new Date(Date.parse(now) - 86_400_000).toISOString();
  const state: DiscoveryState = {
    interests: [], interestEvidence: [], interestSessionSettings: [], candidates: [], candidateInterestMatches: [],
    recommendations: [], recommendationContents: [], recommendationStates: [], preferenceSets: [], preferences: [], preferenceEvidence: [],
  };
  for (const entry of initial.interests) {
    const createdAt = entry.createdAt ?? now;
    const updatedAt = entry.updatedAt ?? createdAt;
    state.interests.push({
      id: mapped(ids.interests, entry.referenceId), description: entry.description, status: entry.status,
      createdFrom: entry.createdFrom ?? 'manual', revision: entry.revision ?? 0, createdAt, updatedAt,
      ...(entry.descriptionUserEditedAt ? { descriptionUserEditedAt: entry.descriptionUserEditedAt } : {}),
      ...(entry.userManagedAt ? { userManagedAt: entry.userManagedAt } : {}),
      ...(entry.status === 'paused' ? { pausedAt: updatedAt } : {}),
      ...(entry.status === 'deleted' ? { deletedAt: updatedAt } : {}),
    });
  }
  for (const session of initial.sessions) {
    state.interestSessionSettings.push({
      id: `evaluation:participation:${session.referenceId}`, sessionId: mapped(ids.sessions, session.referenceId),
      participation: session.participation ?? 'included', effectiveFrom: session.effectiveFrom ?? now,
      createdAt: now, updatedAt: now,
    });
  }
  for (const entry of initial.interestEvidence ?? []) {
    const session = initial.sessions[0];
    if (!session?.turns[entry.userTurnIndex]) throw new Error(`Interest evidence references missing user turn: ${entry.referenceId}.`);
    const createdAt = entry.createdAt ?? now;
    state.interestEvidence.push({
      id: `evaluation:evidence:${entry.referenceId}`, sessionId: mapped(ids.sessions, session.referenceId),
      messageId: `evaluation:user:${session.referenceId}:${entry.userTurnIndex + 1}`,
      ...(entry.interestReferenceId ? { interestId: mapped(ids.interests, entry.interestReferenceId) } : {}),
      description: entry.description, effect: entry.effect, confidence: entry.confidence, status: entry.status, createdAt,
      ...(entry.status === 'applied' ? { appliedAt: createdAt } : {}),
      ...(entry.status === 'retracted' ? { retractedAt: createdAt } : {}),
    });
  }
  for (const entry of initial.candidates) {
    const recommendation = initial.recommendations.find(({ candidateReferenceId }) => candidateReferenceId === entry.referenceId);
    const createdAt = entry.createdAt ?? (recommendation ? recommendation.publishedAt ?? previousDay : now);
    const id = mapped(ids.candidates, entry.referenceId);
    if (recommendation && entry.status && entry.status !== 'consumed') throw new Error(`Previously recommended Candidate must be consumed: ${entry.referenceId}.`);
    state.candidates.push({
      id, contentIdentity: canonicalContentIdentity(entry), sourceId: entry.sourceId,
      canonicalUrl: normalizeContentUrl(entry.canonicalUrl), contentType: entry.contentType ?? 'article', title: entry.title,
      ...(entry.sourceContentId ? { sourceContentId: entry.sourceContentId } : {}),
      ...(entry.author ? { author: entry.author } : {}),
      ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
      ...(entry.description ? { description: entry.description } : {}),
      contentSummary: entry.contentSummary ?? entry.description ?? entry.title,
      ...(entry.contentText ? { contentExcerpt: entry.contentText } : {}), contentTruncated: entry.contentTruncated ?? false,
      ...(entry.coverUrl ? { coverUrl: entry.coverUrl } : {}),
      status: entry.status ?? (recommendation ? 'consumed' : 'available'), createdAt,
      expiresAt: entry.expiresAt ?? new Date(Date.parse(createdAt) + 30 * 86_400_000).toISOString(),
    });
    for (const interestReferenceId of entry.matchedInterestReferenceIds) {
      state.candidateInterestMatches.push({ id: `${id}:match:${interestReferenceId}`, candidateId: id,
        interestId: mapped(ids.interests, interestReferenceId), relevance: entry.relevance,
        matchReason: `Authored ${entry.relevance} association with ${interestReferenceId}.`,
      });
    }
  }
  const positions = new Map<string, number>();
  let reactionSequence = 0;
  for (const entry of initial.recommendations) {
    const id = mapped(ids.recommendations, entry.referenceId);
    const candidate = state.candidates.find(({ id: candidateId }) => candidateId === mapped(ids.candidates, entry.candidateReferenceId));
    const authoredCandidate = initial.candidates.find(({ referenceId }) => referenceId === entry.candidateReferenceId);
    if (!candidate || !authoredCandidate) throw new Error(`Missing Recommendation Candidate: ${entry.referenceId}.`);
    const matches = state.candidateInterestMatches.filter(({ candidateId }) => candidateId === candidate.id);
    const primaryInterestId = matches[0]?.interestId;
    if (!primaryInterestId) throw new Error(`Recommendation has no Interest: ${entry.referenceId}.`);
    const publishedAt = entry.publishedAt ?? previousDay;
    const localDate = entry.localDate ?? publishedAt.slice(0, 10);
    const position = positions.get(localDate) ?? 0;
    positions.set(localDate, position + 1);
    state.recommendations.push({ id, candidateId: candidate.id, contentIdentity: candidate.contentIdentity, localDate, position,
      recommendationReason: entry.reason, publishedAt, selectionBasis: {
        primaryInterestId, matchedInterestIds: matches.map(({ interestId }) => interestId),
        interestRevisions: matches.map(({ interestId }) => ({ interestId, revision: state.interests.find(({ id: interestIdValue }) => interestIdValue === interestId)?.revision ?? 0 })),
        preferenceRevisions: [],
      },
    });
    const { id: _id, contentIdentity: _identity, status: _status, createdAt: _created, expiresAt: _expires, publishedAt: contentPublishedAt, ...content } = candidate;
    state.recommendationContents.push({ ...content, id: `${id}:content`, recommendationId: id, sourceName: authoredCandidate.sourceName,
      ...(contentPublishedAt ? { contentPublishedAt } : {}),
    });
    const override = initial.existingReactions.find(({ recommendationReferenceId }) => recommendationReferenceId === entry.referenceId);
    const reaction = override?.reaction ?? entry.reaction;
    const reactionRevision = entry.reactionRevision ?? (reaction === 'none' ? 0 : 1);
    state.recommendationStates.push({ id: `${id}:state`, recommendationId: id,
      ...(reaction !== 'none' ? { reaction } : {}), reactionRevision, reactionSequence: entry.reactionSequence ?? (reactionRevision > 0 ? ++reactionSequence : 0),
      ...(reactionRevision > 0 ? { reactionChangedAt: entry.reactionChangedAt ?? now } : {}),
      ...(entry.learnedReaction && entry.learnedReaction !== 'none' ? { learnedReaction: entry.learnedReaction } : {}),
      learnedReactionRevision: entry.learnedReactionRevision ?? 0, updatedAt: now,
    });
  }
  for (const entry of initial.preferences) {
    const interestId = entry.interestReferenceId ? mapped(ids.interests, entry.interestReferenceId) : undefined;
    const preferenceSetId = `evaluation:preference-set:${entry.interestReferenceId ?? 'exploration'}`;
    if (!state.preferenceSets.some(({ id }) => id === preferenceSetId)) {
      state.preferenceSets.push({ id: preferenceSetId, ...(interestId ? { scope: 'interest', interestId } : { scope: 'exploration' }), revision: 1, processedRevision: 1, policyRevision: 0, createdAt: now, updatedAt: now });
    }
    state.preferences.push({ id: entry.id, preferenceSetId, origin: entry.origin ?? 'learned', status: entry.status ?? 'active', revision: entry.revision ?? 1,
      ...(entry.origin !== 'user' ? { polarity: entry.polarity, dimension: entry.dimension } : { userEditedAt: entry.userEditedAt ?? now }),
      ...(entry.deletedAt ? { deletedAt: entry.deletedAt } : {}), ...(entry.deletedFeedbackSequence !== undefined ? { deletedFeedbackSequence: entry.deletedFeedbackSequence } : {}), statement: entry.statement, createdAt: now, updatedAt: now });
    for (const referenceId of entry.supportingRecommendationReferenceIds) {
      const recommendationId = mapped(ids.recommendations, referenceId);
      const reaction = state.recommendationStates.find((value) => value.recommendationId === recommendationId);
      if (!reaction?.learnedReaction || reaction.learnedReactionRevision === 0) {
        throw new Error(`Existing Preference requires an explicitly learned feedback revision: ${entry.id}/${referenceId}.`);
      }
      state.preferenceEvidence.push({ id: `${entry.id}:evidence:${referenceId}`, preferenceId: entry.id, recommendationId,
        reaction: reaction.learnedReaction, reactionRevision: reaction.learnedReactionRevision, relation: 'support', createdAt: now, updatedAt: now,
      });
    }
  }
  for (const entry of initial.preferenceSets ?? []) {
    const id = `evaluation:preference-set:${entry.interestReferenceId ?? 'exploration'}`;
    const existing = state.preferenceSets.find((set) => set.id === id);
    const scope = entry.interestReferenceId ? { scope: 'interest' as const, interestId: mapped(ids.interests, entry.interestReferenceId) } : { scope: 'exploration' as const };
    const set = { id, ...scope, revision: entry.revision, policyRevision: entry.policyRevision, ...(entry.processedRevision !== undefined ? { processedRevision: entry.processedRevision } : {}), createdAt: now, updatedAt: now };
    if (existing) state.preferenceSets[state.preferenceSets.indexOf(existing)] = set;
    else state.preferenceSets.push(set);
  }
  return state;
}

function mapped(values: Readonly<Record<string, string>>, referenceId: string): string {
  const id = values[referenceId];
  if (!id) throw new Error(`Initial-state reference was not installed: ${referenceId}.`);
  return id;
}
