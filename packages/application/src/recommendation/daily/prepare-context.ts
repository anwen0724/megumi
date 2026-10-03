/* Builds the daily recommendation prompt from its frozen product snapshot. */
import { buildSystemPrompt, escapeXmlText, loadSystemInstructionDocuments, type AgentContext } from '@megumi/agent';
import { contextPreference } from '../preferences/prepare-context';
import type { CandidateWorksetSnapshot } from './candidate-workset';

/** Projects the frozen business snapshot for prompt construction and diagnostics. */
export function recommendationFacts(attempt: CandidateWorksetSnapshot) {
  const preferenceSnapshots = attempt.preferences;
  const preferences = new Map(preferenceSnapshots.flatMap(snapshot => snapshot.preferenceSet.interestId
    ? [[snapshot.preferenceSet.interestId, contextPreference(snapshot)] as const] : []));
  const interests = attempt.interests.map((interest) => ({
    interestId: interest.id,
    description: interest.description,
    status: interest.status,
    ...(interest.descriptionUserEditedAt ? { descriptionUserEditedAt: interest.descriptionUserEditedAt } : {}),
    interestRevision: interest.revision,
    ...(preferences.has(interest.id) ? { preference: preferences.get(interest.id)! } : {}),
  }));
  const facts = {
    asOf: attempt.snapshotAt,
    execution: {
      requestId: attempt.requestId,
      localDate: attempt.localDate,
      actualTarget: attempt.actualTarget,
      eligibleCount: attempt.rankedCandidates.length,
      workingSetCount: attempt.workingSetCount,
    },
    interests,
    preferences: preferenceSnapshots.map(contextPreference),
    candidates: attempt.rankedCandidates.slice(0, attempt.workingSetCount).map((entry) => ({
      ...candidateSummary({ ...entry.candidate, sourceName: entry.sourceName }),
      matchedInterestIds: entry.interestMatches.map(({ interestId }) => interestId),
      interestMatches: entry.interestMatches.map(({ interestId, relevance, matchReason }) => ({
        interestId,
        relevance,
        matchReason,
      })),
    })),
    recentRecommendations: attempt.history.map((recommendation) => ({
      recommendationId: recommendation.id,
      contentIdentity: recommendation.contentIdentity,
      sourceName: recommendation.content.sourceName,
      contentType: recommendation.content.contentType,
      title: recommendation.content.title,
      recommendationReason: recommendation.recommendationReason,
      publishedAt: recommendation.publishedAt,
      matchedInterestIds: recommendation.selectionBasis.matchedInterestIds,
      ...(recommendation.state.reaction ? { reaction: recommendation.state.reaction } : {}),
    })),
    ranking: [
      ...attempt.rankedCandidates.map((entry) => ({
        candidateId: entry.candidate.id,
        eligible: true as const,
        rank: entry.rank,
        relevanceRank: entry.relevanceRank,
        rankingFacts: entry.rankingFacts,
      })),
      ...attempt.exclusions.map((entry) => ({
        candidateId: entry.candidateId,
        eligible: false as const,
        exclusionReason: entry.reason,
      })),
    ],
  };
  return facts;
}

/** Supplies the initial workset and all subsequent replies and tool results. */
export function createRecommendationContext(options: {
  readonly snapshot: CandidateWorksetSnapshot;
  readonly instructionDocuments: readonly { instructionId: string; sourcePath: string; }[];
}): AgentContext {
  const facts = recommendationFacts(options.snapshot);
  const material = {
    execution: facts.execution, interests: facts.interests,
    preferences: facts.preferences, candidates: facts.candidates,
    recent_recommendations: facts.recentRecommendations.slice(0, 50)
  };
  const content = [
    'Execute the following Recommendation task.', '', '<recommendation_material>',
    `  <local_date>${escapeXmlText(options.snapshot.localDate)}</local_date>`,
    ...Object.entries(material).map(([key, value]) => `  <${key}>${escapeXmlText(JSON.stringify(value))}</${key}>`),
    '</recommendation_material>',
  ].join('\n');
  return {
    async prepare({ runMessages, tools, signal }) {
      const documents = await loadSystemInstructionDocuments({ documents: options.instructionDocuments, signal });
      signal.throwIfAborted();
      return {
        systemPrompt: buildSystemPrompt({ systemInstructions: documents, tools, includeAvailableTools: false }),
        messages: [{ role: 'user', content, timestamp: runMessages[0]?.timestamp ?? Date.parse(options.snapshot.snapshotAt) }, ...runMessages.slice(1)],
        tools,
      };
    },
  };
}

function candidateSummary(candidate: {
  readonly id: string;
  readonly contentIdentity: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly canonicalUrl: string;
  readonly contentType: string;
  readonly title: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly description?: string;
  readonly contentSummary: string;
  readonly contentExcerpt?: string;
  readonly contentTruncated: boolean;
}) {
  return {
    candidateId: candidate.id,
    contentIdentity: candidate.contentIdentity,
    sourceId: candidate.sourceId,
    sourceName: candidate.sourceName,
    canonicalUrl: candidate.canonicalUrl,
    contentType: candidate.contentType,
    title: candidate.title,
    ...(candidate.author ? { author: candidate.author } : {}),
    ...(candidate.publishedAt ? { contentPublishedAt: candidate.publishedAt } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    contentSummary: candidate.contentSummary,
    contentTruncated: candidate.contentTruncated,
    evidenceCompleteness: candidate.contentExcerpt
      ? candidate.contentTruncated ? 'partial' as const : 'full' as const
      : candidate.description ? 'partial' as const : 'metadata_only' as const,
  };
}
