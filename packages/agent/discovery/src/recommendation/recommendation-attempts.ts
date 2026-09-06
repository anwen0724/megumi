/* Holds one Agent Core execution's frozen Recommendation snapshot and Tool-visible working set. */
import type { PreparePreferencesResult } from '../preferences/preference-learning-runtime';
import { z } from 'zod';
import type { RawToolResult } from '@megumi/tools';
import type { Observability } from '@megumi/observability';
import type {
  RankedRecommendationCandidate,
  RecommendationCandidate,
  RecommendationExclusionReason,
} from './recommendation';
import type { Interest } from '../interests/interest';
import type { PreferenceSetDetail, PreferenceGuard } from '../preferences/preference';
import type { Recommendation } from './recommendation';
import type { RecommendationRepository } from '../persistence/recommendation-repository';

const CandidateInputSchema = z.object({ candidateId: z.string().min(1) }).strict();
const ExpandInputSchema = z.object({}).strict();
const PublishInputSchema = z.object({
  items: z.array(z.object({
    candidateId: z.string().min(1),
    recommendationReason: z.string().trim().min(1).refine((value) => [...value].length <= 1000),
  }).strict()).min(1).max(100),
}).strict();

interface Attempt {
  readonly preferencePreparation?: Pick<PreparePreferencesResult, 'status' | 'scopeResults' | 'failures'>;
  readonly preferenceGuard?: PreferenceGuard;
  inputChanged?: boolean;
  readonly requestId: string;
  readonly localDate: string;
  readonly snapshotAt: string;
  readonly actualTarget: number;
  readonly workingSetCount: number;
  readonly rankedCandidates: readonly RankedRecommendationCandidate[];
  readonly exclusions: readonly { readonly candidateId: string; readonly reason: RecommendationExclusionReason }[];
  readonly candidatesById: ReadonlyMap<string, RecommendationCandidate>;
  readonly exposedCandidateIds: Set<string>;
  readonly interestRevisions: readonly { readonly interestId: string; readonly revision: number }[];
  readonly preferenceRevisions: readonly { readonly preferenceSetId: string; readonly revision: number }[];
  readonly interests: readonly Interest[];
  readonly preferences: readonly PreferenceSetDetail[];
  readonly history: readonly Recommendation[];
  readonly repository: RecommendationRepository;
  readonly now: () => string;
  exposedCount: number;
  published: boolean;
}

export interface StartRecommendationAttemptRequest {
  readonly preferencePreparation?: Pick<PreparePreferencesResult, 'status' | 'scopeResults' | 'failures'>;
  readonly preferenceGuard?: PreferenceGuard;
  readonly requestId: string;
  readonly executionId: string;
  readonly localDate: string;
  readonly snapshotAt: string;
  readonly actualTarget: number;
  readonly workingSetCount: number;
  readonly rankedCandidates: readonly RankedRecommendationCandidate[];
  readonly exclusions: readonly { readonly candidateId: string; readonly reason: RecommendationExclusionReason }[];
  readonly interestRevisions: readonly { readonly interestId: string; readonly revision: number }[];
  readonly preferenceRevisions: readonly { readonly preferenceSetId: string; readonly revision: number }[];
  readonly interests: readonly Interest[];
  readonly preferences: readonly PreferenceSetDetail[];
  readonly history: readonly Recommendation[];
  readonly repository: RecommendationRepository;
  readonly now: () => string;
}

export interface RecommendationAttempts {
  /** Reports a refused stale-input publication before disposing the execution snapshot. */
  hasInputChanged(executionId: string): boolean;
  start(request: StartRecommendationAttemptRequest): void;
  getSnapshot(executionId: string): Omit<StartRecommendationAttemptRequest, 'repository' | 'now'> | undefined;
  dispose(executionId: string): void;
  readRecommendationCandidate(request: ToolRequest): Promise<RawToolResult>;
  expandRecommendationWorkingSet(request: ToolRequest): Promise<RawToolResult>;
  publishRecommendations(request: ToolRequest): Promise<RawToolResult>;
}

interface ToolRequest {
  readonly executionId: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

/** Creates process-local Recommendation Tool state; it never owns Agent execution lifecycle. */
export function createRecommendationAttempts(options: {
  readonly observability?: Observability;
} = {}): RecommendationAttempts {
  const attempts = new Map<string, Attempt>();
  return {
    hasInputChanged: (executionId) => attempts.get(executionId)?.inputChanged ?? false,
    start(request) {
      if (attempts.has(request.executionId)) throw new Error('Recommendation execution already has Tool state.');
      const exposedCount = Math.min(request.workingSetCount, request.rankedCandidates.length);
      attempts.set(request.executionId, {
        ...request,
        candidatesById: new Map(request.rankedCandidates.map((candidate) => [candidate.candidate.id, candidate])),
        exposedCandidateIds: new Set(
          request.rankedCandidates.slice(0, exposedCount).map(({ candidate }) => candidate.id),
        ),
        exposedCount,
        published: false,
      });
    },
    getSnapshot(executionId) {
      const attempt = attempts.get(executionId);
      if (!attempt) return undefined;
      return {
        preferenceGuard: attempt.preferenceGuard,
        ...(attempt.preferencePreparation ? { preferencePreparation: attempt.preferencePreparation } : {}),
        requestId: attempt.requestId,
        executionId,
        localDate: attempt.localDate,
        snapshotAt: attempt.snapshotAt,
        actualTarget: attempt.actualTarget,
        workingSetCount: attempt.workingSetCount,
        rankedCandidates: attempt.rankedCandidates,
        exclusions: attempt.exclusions,
        interestRevisions: attempt.interestRevisions,
        preferenceRevisions: attempt.preferenceRevisions,
        interests: attempt.interests,
        preferences: attempt.preferences,
        history: attempt.history,
      };
    },
    dispose(executionId) {
      attempts.delete(executionId);
    },
    async readRecommendationCandidate(request) {
      const attempt = availableAttempt(attempts, request);
      if ('error' in attempt) return attempt.error;
      const parsed = CandidateInputSchema.safeParse(request.input);
      if (!parsed.success) return toolError('invalid_candidate_request', 'Candidate ID is required.');
      if (!attempt.exposedCandidateIds.has(parsed.data.candidateId)) {
        return toolError('candidate_not_exposed', 'Candidate has not been exposed in this working set.');
      }
      const candidate = attempt.candidatesById.get(parsed.data.candidateId);
      return candidate
        ? toolSuccess({ status: 'read', candidate })
        : toolError('candidate_not_in_snapshot', 'Candidate is not part of this execution snapshot.');
    },
    async expandRecommendationWorkingSet(request) {
      const attempt = availableAttempt(attempts, request);
      if ('error' in attempt) return attempt.error;
      if (!ExpandInputSchema.safeParse(request.input).success) {
        return toolError('invalid_expand_request', 'Working-set expansion does not accept arguments.');
      }
      const next = attempt.rankedCandidates.slice(
        attempt.exposedCount,
        attempt.exposedCount + attempt.workingSetCount,
      );
      attempt.exposedCount += next.length;
      for (const { candidate } of next) attempt.exposedCandidateIds.add(candidate.id);
      safeRecord(options.observability, {
        type: 'recommendation.working_set.expanded',
        requestId: attempt.requestId,
        executionId: request.executionId,
        exposedCount: attempt.exposedCount,
      });
      return toolSuccess({
        status: next.length > 0 ? 'expanded' : 'exhausted',
        candidateIds: next.map(({ candidate }) => candidate.id),
        candidates: next,
        remainingCount: attempt.rankedCandidates.length - attempt.exposedCount,
      });
    },
    async publishRecommendations(request) {
      const attempt = availableAttempt(attempts, request);
      if ('error' in attempt) return attempt.error;
      const parsed = PublishInputSchema.safeParse(request.input);
      if (!parsed.success) return toolError('selection_invalid', 'Ordered Candidate IDs and reasons are required.');
      if (parsed.data.items.length !== attempt.actualTarget) {
        return toolError('selection_count_invalid', `Selection must contain exactly ${attempt.actualTarget} items.`);
      }
      const candidateIds = parsed.data.items.map(({ candidateId }) => candidateId);
      if (new Set(candidateIds).size !== candidateIds.length) {
        return toolError('candidate_duplicated', 'A Candidate may be selected only once.');
      }
      const hidden = candidateIds.filter((candidateId) => !attempt.exposedCandidateIds.has(candidateId));
      if (hidden.length > 0) {
        return toolError('candidate_not_exposed', 'Every selected Candidate must be exposed first.', {
          candidateIds: hidden,
        });
      }
      const unknown = candidateIds.filter((candidateId) => !attempt.candidatesById.has(candidateId));
      if (unknown.length > 0) {
        return toolError('candidate_not_in_snapshot', 'Every selected Candidate must belong to the snapshot.', {
          candidateIds: unknown,
        });
      }
      const result = attempt.repository.publish({
        preferenceGuard: attempt.preferenceGuard,
        localDate: attempt.localDate,
        snapshotAt: attempt.snapshotAt,
        publishedAt: attempt.now(),
        items: parsed.data.items.map((item) => {
          const candidate = attempt.candidatesById.get(item.candidateId);
          if (!candidate) throw new Error('Validated Candidate disappeared from immutable Tool state.');
          const primaryInterestId = primaryInterest(candidate);
          return {
            ...item,
            sourceName: candidate.sourceName,
            selectionBasis: {
              ...(attempt.preferenceGuard ? { preferencePolicyRevisions: attempt.preferenceGuard.scopes.map(({ id, policyRevision }) => ({ setId: id, policyRevision })) } : {}),
              primaryInterestId,
              matchedInterestIds: candidate.interestMatches.map(({ interestId }) => interestId),
              interestRevisions: attempt.interestRevisions.filter(({ interestId }) => (
                candidate.interestMatches.some((match) => match.interestId === interestId)
              )),
              preferenceRevisions: [...attempt.preferenceRevisions],
            },
          };
        }),
      });
      if (result.status === 'conflict') {
        return toolError('publication_conflict', 'Candidate state conflicts with the frozen publication.', {
          candidateIds: result.candidateIds,
        });
      }
      if (result.status === 'input_changed') {
        attempt.inputChanged = true;
        return toolError('input_changed', 'User requirements changed; this execution cannot publish its old selection.');
      }
      attempt.published = true;
      return toolSuccess({
        status: result.status,
        count: result.collection.items.length,
        recommendationIds: result.collection.items.map(({ id }) => id),
      });
    },
  };
}

function availableAttempt(
  attempts: ReadonlyMap<string, Attempt>,
  request: ToolRequest,
): Attempt | { readonly error: RawToolResult } {
  if (request.signal.aborted) return { error: toolError('tool_cancelled', 'Recommendation Tool was cancelled.') };
  const attempt = attempts.get(request.executionId);
  if (!attempt) return { error: toolError('attempt_not_found', 'Recommendation execution was not found.') };
  if (attempt.published) return { error: toolError('already_published', 'Recommendation was already published.') };
  return attempt;
}

function primaryInterest(candidate: RecommendationCandidate): string {
  const rank = { direct: 0, adjacent: 1, exploration: 2 } as const;
  const match = [...candidate.interestMatches].sort((left, right) => (
    rank[left.relevance] - rank[right.relevance] || left.interestId.localeCompare(right.interestId)
  ))[0];
  if (!match) throw new Error('Eligible Recommendation Candidate has no Interest match.');
  return match.interestId;
}

function toolSuccess(content: unknown): RawToolResult {
  return { outputKind: 'json', content };
}

function toolError(code: string, message: string, details: Record<string, unknown> = {}): RawToolResult {
  return { outputKind: 'json', content: { status: 'failed', code, message, ...details }, isError: true };
}

function safeRecord(
  observability: Observability | undefined,
  event: {
    readonly type: 'recommendation.working_set.expanded';
    readonly requestId: string;
    readonly executionId: string;
    readonly exposedCount: number;
  },
): void {
  try {
    observability?.recordEvent(event);
  } catch {
    // Trace diagnostics cannot alter execution-local Tool state.
  }
}
