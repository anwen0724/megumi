/* Owns one frozen candidate workset, its exposed candidates and accepted draft. */
import type { RawToolResult } from '@megumi/agent';
import { z } from 'zod';
import type { Observability } from '../../observability/index';
import type { Interest } from '../interests/interest-catalog';
import type { PreparePreferencesResult } from '../preferences/preference-learning';
import type { PreferenceGuard, PreferenceSetDetail } from '../preferences/preference-rules';
import type { RankedRecommendationCandidate, Recommendation, RecommendationCandidate, RecommendationExclusionReason } from './publish-recommendations';

const CandidateInputSchema = z.object({ candidateId: z.string().min(1) }).strict();

const ExpandInputSchema = z.object({}).strict();

const DraftInputSchema = z.object({
  items: z.array(z.object({
    candidateId: z.string().min(1),
    recommendationReason: z.string().trim().min(1).refine((value) => [...value].length <= 1000),
  }).strict()).min(1).max(100),
}).strict();

interface WorkingState extends CandidateWorksetSnapshot {
  readonly candidatesById: ReadonlyMap<string, RecommendationCandidate>;
  readonly exposedCandidateIds: Set<string>;
  exposedCount: number;
  draft?: RecommendationDraft;
}

export interface CandidateWorksetSnapshot {
  readonly preferencePreparation?: Pick<PreparePreferencesResult, 'status' | 'scopeResults' | 'failures'>;
  readonly preferenceGuard?: PreferenceGuard;
  readonly requestId: string;
  readonly localDate: string;
  readonly snapshotAt: string;
  readonly actualTarget: number;
  readonly workingSetCount: number;
  readonly rankedCandidates: readonly RankedRecommendationCandidate[];
  readonly exclusions: readonly { readonly candidateId: string; readonly reason: RecommendationExclusionReason; }[];
  readonly interestRevisions: readonly { readonly interestId: string; readonly revision: number; }[];
  readonly preferenceRevisions: readonly { readonly preferenceSetId: string; readonly revision: number; }[];
  readonly interests: readonly Interest[];
  readonly preferences: readonly PreferenceSetDetail[];
  readonly history: readonly Recommendation[];
}

export interface CandidateWorkset {
  getSnapshot(): CandidateWorksetSnapshot;
  getDraft(): RecommendationDraft | undefined;
  readRecommendationCandidate(request: ToolRequest): Promise<RawToolResult>;
  expandRecommendationWorkingSet(request: ToolRequest): Promise<RawToolResult>;
  submitRecommendations(request: ToolRequest): Promise<RawToolResult>;
}

export type RecommendationDraft = z.infer<typeof DraftInputSchema>;

interface ToolRequest {
  readonly executionId: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

/** Binds immutable recommendation inputs and draft state to one product attempt. */
export function createCandidateWorkset(
  input: CandidateWorksetSnapshot,
  options: { readonly observability?: Observability; } = {},
): CandidateWorkset {
  const snapshot = structuredClone(input);
  const exposedCount = Math.min(snapshot.workingSetCount, snapshot.rankedCandidates.length);
  const attempt: WorkingState = {
    ...snapshot,
    candidatesById: new Map(snapshot.rankedCandidates.map(candidate => [candidate.candidate.id, candidate])),
    exposedCandidateIds: new Set(snapshot.rankedCandidates.slice(0, exposedCount).map(({ candidate }) => candidate.id)),
    exposedCount,
  };
  return {
    getSnapshot: () => structuredClone(snapshot),
    getDraft: () => attempt.draft && structuredClone(attempt.draft),
    async readRecommendationCandidate(request) {
      const unavailable = unavailableResult(attempt, request.signal);
      if (unavailable) return unavailable;
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
      const unavailable = unavailableResult(attempt, request.signal);
      if (unavailable) return unavailable;
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
      const unavailable = unavailableResult(attempt, request.signal);
      if (unavailable) return unavailable;
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
  };
}

function unavailableResult(state: WorkingState, signal: AbortSignal): RawToolResult | undefined {
  if (signal.aborted) return toolError('tool_cancelled', 'Recommendation Tool was cancelled.');
  if (state.draft) return toolError('draft_already_accepted', 'Recommendation draft was already accepted.');
  return undefined;
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
