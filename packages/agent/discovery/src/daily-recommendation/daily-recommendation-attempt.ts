/*
 * Holds execution-scoped Candidate IDs and read budget while delegating durable publication to the business Owner.
 */
import { z } from 'zod';
import type { RawToolResult } from '@megumi/tools';
import type { DailyCandidateWindow } from './daily-recommendation';
import type { DailyRecommendationRepository } from '../persistence/daily-recommendation-repository';

const ReadInputSchema = z.object({ candidateId: z.string().min(1) }).strict();
const PublishInputSchema = z.object({
  items: z.array(z.object({
    candidateId: z.string().min(1),
    recommendationReason: z.string().trim().min(1).max(1000),
  }).strict()).min(1).max(100),
}).strict();

interface AttemptRecord {
  readonly batchId: string;
  readonly allowedCandidateIds: readonly string[];
  readonly allowedCandidateIdSet: ReadonlySet<string>;
  readonly readCandidateIds: Set<string>;
  readonly readBudget: number;
  readonly repository: DailyRecommendationRepository;
  readonly createRecommendationId: () => string;
  readonly now: () => string;
  published: boolean;
}

export interface DailyRecommendationAttempts {
  /** Registers one accepted Daily Recommendation execution without copying Candidate contents. */
  start(request: {
    readonly executionId: string;
    readonly batchId: string;
    readonly window: DailyCandidateWindow;
    readonly repository: DailyRecommendationRepository;
    readonly createRecommendationId: () => string;
    readonly now: () => string;
  }): void;
  /** Releases execution-scoped IDs and budget facts. */
  dispose(executionId: string): void;
  /** Reads one persisted local Candidate from the fixed execution window. */
  readPoolCandidate(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
  /** Commits the Agent's complete ordered selection as the terminal business action. */
  publishDailyRecommendations(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

/** Creates the process-local Tool operation state for Daily Recommendation executions. */
export function createDailyRecommendationAttempts(): DailyRecommendationAttempts {
  const attempts = new Map<string, AttemptRecord>();
  return {
    start(request) {
      if (attempts.has(request.executionId)) {
        throw new Error(`Daily Recommendation attempt already exists: ${request.executionId}.`);
      }
      const allowedCandidateIds = request.window.candidates.map(({ candidateId }) => candidateId);
      attempts.set(request.executionId, {
        batchId: request.batchId,
        allowedCandidateIds,
        allowedCandidateIdSet: new Set(allowedCandidateIds),
        readCandidateIds: new Set(),
        readBudget: Math.min(allowedCandidateIds.length, 20),
        repository: request.repository,
        createRecommendationId: request.createRecommendationId,
        now: request.now,
        published: false,
      });
    },
    dispose(executionId) {
      attempts.delete(executionId);
    },
    async readPoolCandidate(request) {
      if (request.signal.aborted) return toolError('tool_cancelled', 'Candidate reading was cancelled.');
      const attempt = attempts.get(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Daily Recommendation attempt was not found.');
      if (attempt.published) return toolError('recommendations_published', 'Recommendations have already been published.');
      const parsed = ReadInputSchema.safeParse(request.input);
      if (!parsed.success || !attempt.allowedCandidateIdSet.has(parsed.data.candidateId)) {
        return toolError('candidate_not_found', 'Candidate is not in this execution window.');
      }
      if (attempt.readCandidateIds.has(parsed.data.candidateId)) {
        return toolError('candidate_already_read', 'Candidate was already read in this execution.');
      }
      if (attempt.readCandidateIds.size >= attempt.readBudget) {
        return toolError('read_budget_exhausted', 'The local Candidate read budget is exhausted.');
      }
      const candidate = attempt.repository.readCandidate(parsed.data.candidateId);
      if (!candidate) return toolError('candidate_not_found', 'Candidate is no longer available locally.');
      attempt.readCandidateIds.add(candidate.candidateId);
      return toolSuccess({ status: 'read', candidate });
    },
    async publishDailyRecommendations(request) {
      if (request.signal.aborted) return toolError('tool_cancelled', 'Recommendation publication was cancelled.');
      const attempt = attempts.get(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Daily Recommendation attempt was not found.');
      const parsed = PublishInputSchema.safeParse(request.input);
      if (!parsed.success) return toolError('invalid_selection', 'Publication requires valid ordered Candidate IDs and reasons.');
      const result = attempt.repository.publish({
        batchId: attempt.batchId,
        executionId: request.executionId,
        publishedAt: attempt.now(),
        allowedCandidateIds: [...attempt.allowedCandidateIds],
        items: parsed.data.items.map((item) => ({
          recommendationId: attempt.createRecommendationId(),
          candidateId: item.candidateId,
          recommendationReason: item.recommendationReason,
        })),
      });
      if (result.status === 'selection_conflict') {
        return toolError('selection_conflict', 'One or more Candidates changed before publication.', {
          unavailableCandidateIds: result.unavailableCandidateIds,
        });
      }
      if (result.status === 'rejected') {
        return toolError(result.reason, 'Daily Recommendation publication was rejected.');
      }
      attempt.published = true;
      return toolSuccess({
        status: 'published',
        count: result.recommendations.length,
        recommendationIds: result.recommendations.map(({ recommendationId }) => recommendationId),
      });
    },
  };
}

function toolSuccess(content: unknown): RawToolResult {
  return { outputKind: 'json', content };
}

function toolError(code: string, message: string, details: Record<string, unknown> = {}): RawToolResult {
  return {
    outputKind: 'json',
    content: { status: 'failed', code, message, ...details },
    isError: true,
  };
}
