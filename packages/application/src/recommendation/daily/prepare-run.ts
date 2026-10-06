/* Prepares authoritative recommendation inputs and the Agent configuration for one attempt. */
import type { AgentConfig, AgentExecutionPolicy } from '@megumi/agent';
import type { Api, Model } from '@megumi/ai';
import { candidatePoolSettings } from '../candidates/candidate-pool';
import type {
  CreateRecommendationsOptions,
  RecommendationSettings,
} from './generate-recommendations';
import type { RecommendationHistoryItem } from './publish-recommendations';
import { rankRecommendationCandidates } from './rank-candidates';

import type { Observability } from '../../observability/index';
import { createRecommendationTools } from './agent-tools';
import {
  createCandidateWorkset,
  type CandidateWorkset,
  type CandidateWorksetSnapshot,
} from './candidate-workset';

export interface RecommendationPreparation {
  readonly policy: AgentExecutionPolicy;
  readonly instructionDocuments: readonly { instructionId: string; sourcePath: string }[];
  readonly resolveModel: (selection?: {
    providerId: string;
    modelId: string;
  }) => Promise<Model<Api> | undefined>;
}

/** Resolves the selected model and fixes this run's tools and completion rule. */
export async function prepareRecommendationRun(
  input: {
    readonly modelSelection?: { providerId: string; modelId: string };
    readonly snapshot: CandidateWorksetSnapshot;
    readonly observability?: Observability;
    readonly signal: AbortSignal;
  },
  dependencies: RecommendationPreparation,
): Promise<{ readonly config: AgentConfig; readonly workset: CandidateWorkset } | undefined> {
  const model = await dependencies.resolveModel(input.modelSelection);
  input.signal.throwIfAborted();
  if (!model) return undefined;
  const workset = createCandidateWorkset(input.snapshot, { observability: input.observability });
  return {
    workset,
    config: {
      model,
      ...(model.reasoning ? { reasoning: 'high' as const } : {}),
      tools: createRecommendationTools(workset),
      permissionMode: 'auto',
      policy: { ...dependencies.policy },
      completeAfterTool: 'submit_recommendations',
    },
  };
}

/** Reads the pool, current interests and preferences before ranking eligible candidates. */
export function prepareRecommendationSnapshot(request: {
  readonly repository: CreateRecommendationsOptions['repository'];
  readonly sourceRegistry: CreateRecommendationsOptions['sourceRegistry'];
  readonly preferenceSource?: CreateRecommendationsOptions['preferenceSource'];
  readonly snapshotAt: string;
  readonly localDate: string;
  readonly settings: RecommendationSettings;
}) {
  const { snapshotAt, localDate, settings } = request;
  const pool = request.repository.getCandidatePoolSnapshot(
    candidatePoolSettings({
      minimumCount: settings.candidatePoolMinimumCount,
      maximumCount: settings.candidatePoolMaximumCount,
      candidateValidityDays: settings.candidateValidityDays,
      candidateContentExcerptMaxCharacters: settings.candidateContentExcerptMaxCharacters,
    }),
  );
  const interests = request.repository
    .listNonDeletedInterests()
    .filter(({ status }) => status === 'active');
  const effectivePreferences = request.repository.listPreferenceSetDetails({ effectiveOnly: true });
  const preferences =
    request.preferenceSource?.(structuredClone(effectivePreferences)) ?? effectivePreferences;
  const history = request.repository.listRecommendationHistory('1970-01-01T00:00:00.000Z');
  const rankingHistory: RecommendationHistoryItem[] = history.map((item) => ({
    recommendationId: item.id,
    candidateId: item.candidateId,
    contentIdentity: item.contentIdentity,
    sourceId: item.content.sourceId,
    contentType: item.content.contentType,
    matchedInterestIds: item.selectionBasis.matchedInterestIds,
    publishedAt: item.publishedAt,
  }));
  const ranking = rankRecommendationCandidates({
    snapshotAt,
    targetCount: settings.recommendationTargetCount,
    workingSetCount: settings.recommendationWorkingSetCount,
    candidates: pool.candidates.map((entry) => ({
      ...entry,
      sourceName: request.sourceRegistry.get(entry.candidate.sourceId)?.descriptor.name ?? '',
    })),
    history: rankingHistory,
  });
  return {
    localDate,
    interests,
    preferences,
    history,
    ranking,
    interestRevisions: interests.map(({ id, revision }) => ({ interestId: id, revision })),
    preferenceGuard: request.repository.getPreferenceGuard(),
    preferenceRevisions: preferences.map(({ preferenceSet }) => ({
      preferenceSetId: preferenceSet.id,
      revision: preferenceSet.revision,
    })),
  };
}
