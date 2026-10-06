/*
 * Owns one maintenance round's execution budget. Each counter has a single
 * owner, is reserved before work is queued, and is charged again when work is
 * retried. Callers that join a running round share this budget; joining never
 * resets it.
 */
import type { CandidateSupplyLimits } from '../../settings/definitions/discovery';

/** Counted external work kinds, each backed by exactly one limit field. */
export type BudgetKind =
  | 'searchCalls'
  | 'fetchCalls'
  | 'planningCalls'
  | 'analysisCalls'
  | 'matchingCalls'
  | 'embeddingCalls';

const BUDGET_LIMIT_FIELDS = {
  searchCalls: 'maxSearchCalls',
  fetchCalls: 'maxFetchCalls',
  planningCalls: 'maxPlanningCalls',
  analysisCalls: 'maxAnalysisCalls',
  matchingCalls: 'maxMatchingCalls',
  embeddingCalls: 'maxEmbeddingCalls',
} as const satisfies Record<BudgetKind, keyof CandidateSupplyLimits>;

/** Model tokens a single request is expected to consume, reserved before sending. */
export interface ModelTokenReservation {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ExecutionBudget {
  /** Reserves one unit before queueing work. False means this round cannot accept it. */
  reserve(kind: BudgetKind): boolean;
  /** Returns a reservation that never reached the external work. */
  release(kind: BudgetKind): void;
  /** Reserves round model tokens before sending a request; charged again on retry. */
  reserveModelTokens(reservation: ModelTokenReservation): boolean;
  remaining(kind: BudgetKind): number;
  remainingModelTokens(): ModelTokenReservation;
  /** True once the round reached its deadline; callers must stop queueing new work. */
  readonly expired: boolean;
}

/**
 * Creates the budget for one round. `startedAt` fixes the deadline, so waiting
 * callers that join later never extend the round.
 */
export function createExecutionBudget(input: {
  limits: CandidateSupplyLimits;
  startedAt: number;
  now?: () => number;
}): ExecutionBudget {
  const now = input.now ?? Date.now;
  const deadline = input.startedAt + input.limits.maxDurationMinutes * 60_000;
  const consumed: Record<BudgetKind, number> = {
    searchCalls: 0,
    fetchCalls: 0,
    planningCalls: 0,
    analysisCalls: 0,
    matchingCalls: 0,
    embeddingCalls: 0,
  };
  let modelInputTokens = 0;
  let modelOutputTokens = 0;

  return {
    reserve(kind) {
      if (now() >= deadline) return false;
      if (consumed[kind] >= input.limits[BUDGET_LIMIT_FIELDS[kind]]) return false;
      consumed[kind] += 1;
      return true;
    },
    release(kind) {
      if (consumed[kind] > 0) consumed[kind] -= 1;
    },
    reserveModelTokens(reservation) {
      if (now() >= deadline) return false;
      if (modelInputTokens + reservation.inputTokens > input.limits.maxModelInputTokens) return false;
      if (modelOutputTokens + reservation.outputTokens > input.limits.maxModelOutputTokens) return false;
      modelInputTokens += reservation.inputTokens;
      modelOutputTokens += reservation.outputTokens;
      return true;
    },
    remaining(kind) {
      return input.limits[BUDGET_LIMIT_FIELDS[kind]] - consumed[kind];
    },
    remainingModelTokens() {
      return {
        inputTokens: input.limits.maxModelInputTokens - modelInputTokens,
        outputTokens: input.limits.maxModelOutputTokens - modelOutputTokens,
      };
    },
    get expired() {
      return now() >= deadline;
    },
  };
}
