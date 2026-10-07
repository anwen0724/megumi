/*
 * Owns the four public supply operations and the single active maintenance
 * round. Reading uses only local facts; the model and source are resolved only
 * when a round actually needs external work. A waiting request joins the round,
 * cancelling removes only its own wait, and close stops accepting work before
 * waiting for the round to finish.
 */
import type { Api, Model } from '@megumi/ai';
import type { DatabaseConnection } from '../../storage/index';
import type { CandidateStorage } from '../candidates/candidate-storage';
import { evaluatePool } from '../candidates/evaluate-candidates';
import type { CandidateSnapshot } from '../candidates/candidate-contracts';
import type { ContentStorage } from '../content/content-storage';
import type { InterestManagement } from '../interests/interest-contracts';
import { createExecutionBudget } from './execution-budget';
import type { SupplyExecutionConfig } from './read-supply-config';
import { runMaintenance, type MaintenanceDependencies } from './run-maintenance';
import {
  CandidateRequirementSchema,
  SupplyLifecycleError,
  type CandidateRequirement,
  type CandidateSupply,
  type MaintenanceHandle,
  type MaintenanceResult,
  type PreparationResult,
  type StopReason,
  type SupplyIssue,
  type UnavailableCode,
  type UsageReader,
} from './supply-contracts';

/** Capabilities that need no external service and stay usable after close. */
export interface LocalSupplyCapabilities {
  readonly database: DatabaseConnection;
  readonly contents: ContentStorage;
  readonly candidates: CandidateStorage;
  readonly usage: UsageReader;
  readonly interests: InterestManagement;
  readonly now: () => number;
}

export type ConfigResolution =
  | { status: 'ok'; config: SupplyExecutionConfig }
  | { status: 'unavailable'; code: UnavailableCode; message: string };

export type RoundResolution =
  | { status: 'ok'; model: Model<Api>; dependencies: MaintenanceDependencies }
  | { status: 'unavailable'; code: UnavailableCode; message: string };

export interface CreateSupplyOptions {
  readonly local: LocalSupplyCapabilities;
  /** Reads the local execution configuration; never touches a model or a source. */
  readonly readConfig: () => Promise<ConfigResolution>;
  /** Resolves the model and external capabilities for one round. */
  readonly openRound: (config: SupplyExecutionConfig) => Promise<RoundResolution>;
  readonly newId: (prefix: string) => string;
}

interface Waiter {
  readonly requirement: CandidateRequirement;
  readonly resolve: (result: PreparationResult) => void;
  /** Reports a failed round; storage failures must not read as a shortage. */
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

interface ActiveRound {
  readonly id: string;
  readonly controller: AbortController;
  readonly waiters: Set<Waiter>;
  /** True once a background trigger asked for this round. */
  background: boolean;
  /** How the finished round stopped, reported to waiters it could not satisfy. */
  stopReason?: StopReason;
  /** What the finished round reported, so an insufficient caller sees the cause. */
  issues?: readonly SupplyIssue[];
  /** Set when the round failed unexpectedly; waiters are rejected with it. */
  failure?: unknown;
  readonly promise: Promise<MaintenanceResult>;
}

export function createCandidateSupply(options: CreateSupplyOptions): CandidateSupply {
  let closed = false;
  let active: ActiveRound | undefined;
  let closing: Promise<void> | undefined;

  return {
    startMaintenance({ reason }): MaintenanceHandle {
      if (closed) throw new SupplyLifecycleError();
      const round = ensureRound(reason === 'startup' || reason === 'periodic');
      return { id: round.id, result: round.promise };
    },

    async prepareCandidates({ requirement, signal }): Promise<PreparationResult> {
      const parsed = CandidateRequirementSchema.safeParse(requirement);
      if (!parsed.success) {
        return {
          status: 'invalid_request',
          code: 'INVALID_REQUIREMENT',
          message: parsed.error.issues.map((issue) => issue.message).join('; '),
        };
      }
      if (closed) {
        return { status: 'unavailable', code: 'SERVICE_CLOSED', message: 'Candidate supply is closed.' };
      }

      const resolved = await options.readConfig();
      if (resolved.status === 'unavailable') {
        return { status: 'unavailable', code: resolved.code, message: resolved.message };
      }
      const snapshot = await readSnapshot(options.local, resolved.config, parsed.data);
      if (snapshot.interests.length === 0) {
        return { status: 'unavailable', code: 'NO_INTERESTS', message: 'No enabled interest is saved.' };
      }
      if (satisfies(snapshot, parsed.data)) return { status: 'ready', snapshot };

      return waitFor(ensureRound(false), parsed.data, signal);
    },

    async listCandidates({ requirement }): Promise<CandidateSnapshot> {
      const parsed = CandidateRequirementSchema.safeParse(requirement);
      if (!parsed.success) {
        throw new Error(
          `Invalid candidate requirement: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
        );
      }
      const resolved = await options.readConfig();
      if (resolved.status === 'unavailable') {
        throw new Error(`Candidate supply configuration is unavailable: ${resolved.message}`);
      }
      return readSnapshot(options.local, resolved.config, parsed.data);
    },

    close(): Promise<void> {
      // Repeated calls wait for the same closing process instead of returning early.
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        const round = active;
        if (!round) return;
        round.controller.abort();
        await round.promise.catch(() => undefined);
      })();
      return closing;
    },
  };

  /** Reuses the running round; only a background trigger promotes it. */
  function ensureRound(background: boolean): ActiveRound {
    if (active) {
      active.background = active.background || background;
      return active;
    }

    const controller = new AbortController();
    const round = {
      id: options.newId('maintenance'),
      controller,
      waiters: new Set<Waiter>(),
      background,
    } as ActiveRound;
    active = round;

    (round as { promise: Promise<MaintenanceResult> }).promise = start(round, background, controller);
    return round;
  }

  async function start(
    round: ActiveRound,
    background: boolean,
    controller: AbortController,
  ): Promise<MaintenanceResult> {
    try {
      const resolvedConfig = await options.readConfig();
      if (resolvedConfig.status === 'unavailable') {
        releaseWaiters(round, {
          status: 'unavailable',
          code: resolvedConfig.code,
          message: resolvedConfig.message,
        });
        return emptyResult(resolvedConfig.code === 'SERVICE_CLOSED' ? 'cancelled' : 'no_work');
      }

      const resolvedRound = await options.openRound(resolvedConfig.config);
      if (resolvedRound.status === 'unavailable') {
        releaseWaiters(round, {
          status: 'unavailable',
          code: resolvedRound.code,
          message: resolvedRound.message,
        });
        return emptyResult('blocked');
      }

      const budget = createExecutionBudget({
        limits: resolvedConfig.config.limits,
        startedAt: options.local.now(),
        now: options.local.now,
      });
      const result = await runMaintenance(resolvedRound.dependencies, {
        trigger: background ? 'startup' : 'periodic',
        budget,
        signal: controller.signal,
        deliver: () => deliver(round, resolvedConfig.config),
        // Waiting callers drive this round's highest-priority demand.
        pendingRequirements: () => [...round.waiters].map((waiter) => waiter.requirement),
      });
      // A waiter that is still unsatisfied must learn why this round ended.
      round.stopReason = result.stopReason;
      round.issues = result.issues;
      return result;
    } catch (error) {
      // Storage and contract failures reject the caller instead of reading as a gap.
      round.failure = error;
      throw error;
    } finally {
      active = undefined;
      await releaseRemaining(round, controller);
    }
  }

  /** Resolves one waiting request as soon as the current snapshot satisfies it. */
  async function deliver(round: ActiveRound, config: SupplyExecutionConfig): Promise<void> {
    for (const waiter of [...round.waiters]) {
      if (waiter.signal?.aborted) {
        settle(round, waiter, { status: 'cancelled' });
        continue;
      }
      const snapshot = await readSnapshot(options.local, config, waiter.requirement);
      if (!stillValid(snapshot, waiter.requirement)) {
        settle(round, waiter, { status: 'input_changed', interests: snapshot.interests });
        continue;
      }
      if (satisfies(snapshot, waiter.requirement)) {
        settle(round, waiter, { status: 'ready', snapshot });
      }
    }
    if (round.waiters.size === 0 && !round.background) round.controller.abort();
  }

  async function releaseRemaining(round: ActiveRound, controller: AbortController): Promise<void> {
    if (round.waiters.size === 0) return;
    // A round that failed did not fall short: the caller must see the failure.
    if (round.failure !== undefined) {
      rejectWaiters(round, round.failure);
      return;
    }
    // A cancelled round never did its work, so a shortage would be a false report.
    if (controller.signal.aborted) {
      releaseWaiters(round, { status: 'cancelled' });
      return;
    }
    const resolved = await options.readConfig();
    if (resolved.status === 'unavailable') {
      releaseWaiters(round, {
        status: 'unavailable',
        code: resolved.code,
        message: resolved.message,
      });
      return;
    }
    for (const waiter of [...round.waiters]) {
      const snapshot = await readSnapshot(options.local, resolved.config, waiter.requirement);
      settle(round, waiter, {
        status: 'insufficient',
        snapshot,
        stopReason: round.stopReason ?? 'budget_exhausted',
        issues: [...(round.issues ?? [])],
      });
    }
  }

  function releaseWaiters(round: ActiveRound, result: PreparationResult): void {
    for (const waiter of [...round.waiters]) settle(round, waiter, result);
  }

  function rejectWaiters(round: ActiveRound, error: unknown): void {
    for (const waiter of [...round.waiters]) {
      if (!round.waiters.delete(waiter)) continue;
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.reject(error);
    }
  }

  function waitFor(
    round: ActiveRound,
    requirement: CandidateRequirement,
    signal?: AbortSignal,
  ): Promise<PreparationResult> {
    return new Promise<PreparationResult>((resolve, reject) => {
      if (signal?.aborted) {
        resolve({ status: 'cancelled' });
        return;
      }
      let waiter: Waiter;
      const onAbort = () => settle(round, waiter, { status: 'cancelled' });
      waiter = {
        requirement,
        resolve,
        reject,
        ...(signal ? { signal, onAbort } : {}),
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      round.waiters.add(waiter);
    });
  }

  function settle(round: ActiveRound, waiter: Waiter, result: PreparationResult): void {
    if (!round.waiters.delete(waiter)) return;
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.resolve(result);
  }
}

/** Reads the current snapshot from saved facts only. */
async function readSnapshot(
  local: LocalSupplyCapabilities,
  config: SupplyExecutionConfig,
  requirement: CandidateRequirement,
): Promise<CandidateSnapshot> {
  const interests = (await local.interests.listInterests()).interests.filter(
    (interest) => interest.enabled,
  );
  const usage = await local.usage.readUsageSnapshot(requirement.pool);
  return evaluatePool(
    { database: local.database, candidates: local.candidates },
    {
      pool: requirement.pool,
      interests,
      usage,
      requirement,
      thresholds: requirement.pool === 'daily' ? config.daily : config.longTerm,
      freshnessDays: config.freshnessDays,
      searchHistoryDays: config.searchHistoryDays,
      now: local.now(),
    },
  ).snapshot;
}

function satisfies(snapshot: CandidateSnapshot, requirement: CandidateRequirement): boolean {
  if (snapshot.counts.total < requirement.minimumCount) return false;
  return requirement.coverage.every((entry) => {
    const count =
      snapshot.counts.byInterest.find((item) => item.interestId === entry.interestId)?.count ?? 0;
    return count >= entry.minimumCount;
  });
}

/** A request whose interests disappeared or were disabled must be re-decided. */
function stillValid(snapshot: CandidateSnapshot, requirement: CandidateRequirement): boolean {
  const enabled = new Set(snapshot.interests.map((interest) => interest.id));
  return requirement.coverage.every((entry) => enabled.has(entry.interestId));
}

function emptyResult(stopReason: MaintenanceResult['stopReason']): MaintenanceResult {
  return {
    status: stopReason === 'cancelled' ? 'cancelled' : 'completed',
    stopReason,
    savedCounts: { discoveredItems: 0, normalizedContents: 0, analyzedContents: 0, newCandidates: 0 },
    poolHealth: [],
    issues: [],
  };
}
