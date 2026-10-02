/* Holds one Agent Core execution's frozen Recommendation snapshot and Tool-visible working set. */
import type { PreparePreferencesResult } from '../preferences/preference-learning';
import { z } from 'zod';
import type { RawToolResult } from '@megumi/agent-runtime/tools/index';
import type { Observability } from '../../observability/index';
import type {
  RankedRecommendationCandidate,
  RecommendationCandidate,
  RecommendationExclusionReason,
} from './recommendation';
import type { Interest } from '../interests/interest';
import type { PreferenceSetDetail, PreferenceGuard } from '../preferences/preference';
import type { Recommendation } from './recommendation';
import type { RecommendationRepository, PublishRecommendationsResult } from './recommendation-repository';

const CandidateInputSchema = z.object({ candidateId: z.string().min(1) }).strict();
const ExpandInputSchema = z.object({}).strict();
const DraftInputSchema = z.object({
  items: z.array(z.object({
    candidateId: z.string().min(1),
    recommendationReason: z.string().trim().min(1).refine((value) => [...value].length <= 1000),
  }).strict()).min(1).max(100),
}).strict();

interface Attempt {
  readonly preferencePreparation?: Pick<PreparePreferencesResult, 'status' | 'scopeResults' | 'failures'>;
  readonly preferenceGuard?: PreferenceGuard;
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
  draft?: z.infer<typeof DraftInputSchema>;
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
  start(request: StartRecommendationAttemptRequest): void;
  getSnapshot(executionId: string): Omit<StartRecommendationAttemptRequest, 'repository' | 'now'> | undefined;
  dispose(executionId: string): void;
  readRecommendationCandidate(request: ToolRequest): Promise<RawToolResult>;
  expandRecommendationWorkingSet(request: ToolRequest): Promise<RawToolResult>;
  /** Validates and stores an execution-local draft; it never writes formal recommendations. */
  submitRecommendations(request: ToolRequest): Promise<RawToolResult>;
  /** Publishes a successful run's draft after checking cancellation and current repository revisions. */
  publishDraft(request: { executionId: string; signal: AbortSignal }): PublishRecommendationsResult | { status: 'cancelled' | 'draft_missing' };
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
    start(request) {
      if (attempts.has(request.executionId)) throw new Error('Recommendation execution already has Tool state.');
      const { repository, now, ...input } = request;
      const snapshot = structuredClone(input);
      const exposedCount = Math.min(snapshot.workingSetCount, snapshot.rankedCandidates.length);
      attempts.set(request.executionId, {
        ...snapshot, repository, now,
        candidatesById: new Map(snapshot.rankedCandidates.map((candidate) => [candidate.candidate.id, candidate])),
        exposedCandidateIds: new Set(
          snapshot.rankedCandidates.slice(0, exposedCount).map(({ candidate }) => candidate.id),
        ),
        exposedCount,
      });
    },
    getSnapshot(executionId) {
      const attempt = attempts.get(executionId);
      if (!attempt) return undefined;
      return structuredClone({
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
      });
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
    async submitRecommendations(request) {
      const attempt = availableAttempt(attempts, request);
      if ('error' in attempt) return attempt.error;
      const parsed = DraftInputSchema.safeParse(request.input);
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
      attempt.draft = parsed.data;
      return toolSuccess({ status: 'accepted', count: parsed.data.items.length });
    },
    publishDraft(request) {
      if (request.signal.aborted) return { status: 'cancelled' };
      const attempt = attempts.get(request.executionId);
      if (!attempt?.draft) return { status: 'draft_missing' };
      return attempt.repository.publish({
        preferenceGuard: attempt.preferenceGuard,
        localDate: attempt.localDate,
        snapshotAt: attempt.snapshotAt,
        publishedAt: attempt.now(),
        items: attempt.draft.items.map((item) => {
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
  if (attempt.draft) return { error: toolError('draft_already_accepted', 'Recommendation draft was already accepted.') };
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
