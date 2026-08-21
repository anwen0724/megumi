/*
 * Owns the only mutable per-Run runtime record: the ActiveRun. It keeps the
 * Run snapshot, the root AbortController, the single Agent execution completion
 * and at most one pending approval wait. Request-id idempotency, per-Session
 * exclusion, and bounded terminal results live here too; no router, resume
 * state, stream buffer or loop position ever does.
 */
import type { SessionEntry, SessionMessageWithAttachments } from '@megumi/session';
import type { ApprovalDecision } from '@megumi/permissions';
import type { RunApproval, RunClock } from './run';
import type { Run, RunFailure } from './run';
import { isTerminalRunStatus } from './run';

export interface StartRequestFingerprint {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly inputDigest: string;
}

export interface StoredStartResult {
  readonly run: Run;
  readonly userMessage: SessionMessageWithAttachments;
  readonly userEntry: SessionEntry;
}

export type StartEstablishmentCompletion =
  | { readonly status: 'started'; readonly result: StoredStartResult }
  | { readonly status: 'failed'; readonly failure: RunFailure };

export type ReserveStartResult =
  | { readonly status: 'reserved'; readonly run: Run }
  | {
      readonly status: 'pending';
      readonly completion: Promise<StartEstablishmentCompletion>;
    }
  | { readonly status: 'already_started'; readonly result: StoredStartResult }
  | { readonly status: 'request_conflict' }
  | { readonly status: 'session_busy'; readonly activeRun: Run };

interface PendingStartRecord {
  readonly status: 'pending';
  readonly fingerprint: StartRequestFingerprint;
  readonly run: Run;
  readonly completion: Promise<StartEstablishmentCompletion>;
  readonly settle: (completion: StartEstablishmentCompletion) => void;
}

interface StartedRecord {
  readonly status: 'started';
  readonly fingerprint: StartRequestFingerprint;
  readonly result: StoredStartResult;
  readonly expiresAtMs?: number;
}

type RequestRecord = PendingStartRecord | StartedRecord;

export type ApprovalResolution =
  | { readonly status: 'approved'; readonly decision: ApprovalDecision }
  | { readonly status: 'denied'; readonly decision: ApprovalDecision }
  | { readonly status: 'cancelled' };

/** The one pending approval wait of an ActiveRun; settled exactly once. */
export interface PendingApproval {
  readonly approvalId: string;
  readonly approval: RunApproval;
  readonly promise: Promise<ApprovalResolution>;
  readonly settle: (resolution: ApprovalResolution) => void;
  settled: boolean;
}

/**
 * The only mutable per-Run runtime record. It never holds a Tool Router,
 * resume state for pending calls, stream output, attempt state
 * or any Agent execution position.
 */
export interface ActiveRun {
  run: Run;
  readonly abortController: AbortController;
  /** Settled exactly once when the single Agent execution converges. */
  readonly completion: Promise<void>;
  pendingApproval?: PendingApproval;
}

export type ResolveApprovalResult =
  | { readonly status: 'accepted'; readonly run: Run }
  | { readonly status: 'not_found' }
  | { readonly status: 'not_waiting'; readonly run: Run }
  | { readonly status: 'already_resolved'; readonly run: Run };

export interface RunRegistryOptions {
  readonly clock: RunClock;
  readonly terminalRunRetentionMs: number;
}

export class RunRegistry {
  private readonly requestRecords = new Map<string, RequestRecord>();
  /** Runs reserved but not yet attached to an ActiveRun (start establishment in flight). */
  private readonly pendingRuns = new Map<string, Run>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly terminalRuns = new Map<string, Run>();
  private readonly executionIdBySession = new Map<string, string>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly options: RunRegistryOptions) {
    if (
      !Number.isInteger(options.terminalRunRetentionMs)
      || options.terminalRunRetentionMs <= 0
    ) {
      throw new TypeError('terminalRunRetentionMs must be a positive integer.');
    }
  }

  reserveStart(input: {
    readonly requestId: string;
    readonly fingerprint: StartRequestFingerprint;
    readonly run: Run;
  }): ReserveStartResult {
    this.pruneExpired();
    const existingRequest = this.requestRecords.get(input.requestId);
    if (existingRequest) {
      if (!sameFingerprint(existingRequest.fingerprint, input.fingerprint)) {
        return { status: 'request_conflict' };
      }
      return existingRequest.status === 'pending'
        ? { status: 'pending', completion: existingRequest.completion }
        : { status: 'already_started', result: existingRequest.result };
    }

    const activeExecutionId = this.executionIdBySession.get(input.fingerprint.sessionId);
    if (activeExecutionId) {
      const run = this.findLiveRun(activeExecutionId);
      if (run && !isTerminalRunStatus(run.status)) {
        return { status: 'session_busy', activeRun: run };
      }
      this.executionIdBySession.delete(input.fingerprint.sessionId);
    }

    assertReservationMatchesRun(input);
    let settle!: (completion: StartEstablishmentCompletion) => void;
    const completion = new Promise<StartEstablishmentCompletion>((resolve) => {
      settle = resolve;
    });
    this.requestRecords.set(input.requestId, {
      status: 'pending',
      fingerprint: input.fingerprint,
      run: input.run,
      completion,
      settle,
    });
    this.pendingRuns.set(input.run.executionId, input.run);
    this.executionIdBySession.set(input.run.sessionId, input.run.executionId);
    return { status: 'reserved', run: input.run };
  }

  completeStart(input: {
    readonly requestId: string;
    readonly result: StoredStartResult;
  }): void {
    const record = this.requestRecords.get(input.requestId);
    if (!record || record.status !== 'pending') {
      throw new Error(`No pending Run start for request ${input.requestId}.`);
    }
    if (record.run.executionId !== input.result.run.executionId) {
      throw new Error('Completed Run start does not match its reserved Run.');
    }

    const startedRecord: StartedRecord = {
      status: 'started',
      fingerprint: record.fingerprint,
      result: input.result,
    };
    this.requestRecords.set(input.requestId, startedRecord);
    record.settle({ status: 'started', result: input.result });
  }

  failStart(input: {
    readonly requestId: string;
    readonly failure: RunFailure;
  }): void {
    const record = this.requestRecords.get(input.requestId);
    if (!record || record.status !== 'pending') {
      throw new Error(`No pending Run start for request ${input.requestId}.`);
    }

    this.requestRecords.delete(input.requestId);
    this.pendingRuns.delete(record.run.executionId);
    if (this.executionIdBySession.get(record.run.sessionId) === record.run.executionId) {
      this.executionIdBySession.delete(record.run.sessionId);
    }
    record.settle({ status: 'failed', failure: input.failure });
    this.notifyIdle();
  }

  /** Registers the single ActiveRun for a started Run. */
  attachActiveRun(activeRun: ActiveRun): void {
    const run = activeRun.run;
    const existing = this.activeRuns.get(run.executionId);
    if (existing) {
      throw new Error(`Run already has an ActiveRun: ${run.executionId}.`);
    }
    this.pendingRuns.delete(run.executionId);
    this.activeRuns.set(run.executionId, activeRun);
    this.executionIdBySession.set(run.sessionId, run.executionId);
  }

  getActiveRun(executionId: string): ActiveRun | undefined {
    return this.activeRuns.get(executionId);
  }

  updateRun(run: Run): void {
    this.pruneExpired();
    const active = this.activeRuns.get(run.executionId);
    if (!active) {
      // A reserved Run may settle directly to a terminal result without a loop.
      const pending = this.pendingRuns.get(run.executionId);
      if (pending) {
        const requestRecord = this.requestRecords.get(run.requestId);
        if (requestRecord?.status === 'started') {
          const expiresAtMs = isTerminalRunStatus(run.status)
            ? this.nowMs() + this.options.terminalRunRetentionMs
            : undefined;
          this.requestRecords.set(run.requestId, {
            ...requestRecord,
            result: { ...requestRecord.result, run },
            ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
          });
        }
        if (isTerminalRunStatus(run.status)) {
          this.pendingRuns.delete(run.executionId);
          this.terminalRuns.set(run.executionId, run);
          this.notifyIdle();
        } else {
          this.pendingRuns.set(run.executionId, run);
        }
        return;
      }
      const previous = this.terminalRuns.get(run.executionId);
      if (previous && isTerminalRunStatus(run.status)) {
        this.terminalRuns.set(run.executionId, run);
      }
      return;
    }
    if (active.run.requestId !== run.requestId || active.run.sessionId !== run.sessionId) {
      throw new Error('Updated Run identity does not match the stored Run.');
    }

    active.run = run;
    const requestRecord = this.requestRecords.get(run.requestId);
    if (requestRecord?.status === 'started') {
      const expiresAtMs = isTerminalRunStatus(run.status)
        ? this.nowMs() + this.options.terminalRunRetentionMs
        : undefined;
      this.requestRecords.set(run.requestId, {
        ...requestRecord,
        result: { ...requestRecord.result, run },
        ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
      });
    }

    if (isTerminalRunStatus(run.status)) {
      // Terminal settlement releases every held resource independently: a
      // failure while cancelling a pending approval must not skip releasing
      // the Session occupancy or dropping the active record.
      let cleanupError: unknown;
      try {
        this.settlePendingApprovalCancelled(run);
      } catch (error) {
        cleanupError = error;
      }
      if (this.executionIdBySession.get(run.sessionId) === run.executionId) {
        this.executionIdBySession.delete(run.sessionId);
      }
      this.activeRuns.delete(run.executionId);
      this.terminalRuns.set(run.executionId, run);
      this.notifyIdle();
      if (cleanupError !== undefined) throw cleanupError;
    }
  }

  getRun(executionId: string): Run | undefined {
    this.pruneExpired();
    const live = this.findLiveRun(executionId);
    if (live) return snapshot(live);
    const terminal = this.terminalRuns.get(executionId);
    return terminal ? snapshot(terminal) : undefined;
  }

  /**
   * Resolves the one non-terminal Run held by the existing Session exclusion
   * index. This is a read of authoritative registry state, not a projection.
   */
  getActive(sessionId: string): Run | undefined {
    const executionId = this.executionIdBySession.get(sessionId);
    if (!executionId) return undefined;
    const run = this.findLiveRun(executionId);
    if (!run || isTerminalRunStatus(run.status)) {
      this.executionIdBySession.delete(sessionId);
      return undefined;
    }
    return snapshot(run);
  }

  private findLiveRun(executionId: string): Run | undefined {
    const active = this.activeRuns.get(executionId);
    if (active) return active.run;
    return this.pendingRuns.get(executionId);
  }

  listActiveRuns(): readonly Run[] {
    this.pruneExpired();
    return [...this.activeRuns.values()]
      .map((active) => snapshot(active.run))
      .filter((run) => !isTerminalRunStatus(run.status));
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError('Run idle timeout must be a non-negative number.');
    }
    if (this.listActiveRuns().length === 0) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (idle: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.idleWaiters.delete(onIdle);
        resolve(idle);
      };
      const onIdle = () => finish(true);
      const timeout = setTimeout(() => finish(false), timeoutMs);
      this.idleWaiters.add(onIdle);
    });
  }

  getStartedResult(requestId: string): StoredStartResult | undefined {
    this.pruneExpired();
    const record = this.requestRecords.get(requestId);
    return record?.status === 'started' ? record.result : undefined;
  }

  /**
   * Registers the one pending approval wait of an ActiveRun and returns its
   * promise. The Agent Adapter awaits it in place; the Run operation entry settles it.
   */
  beginApprovalWait(input: {
    readonly executionId: string;
    readonly approval: RunApproval;
  }): Promise<ApprovalResolution> {
    const active = this.activeRuns.get(input.executionId);
    if (!active || isTerminalRunStatus(active.run.status)) {
      throw new Error(`Cannot wait for approval on inactive Run ${input.executionId}.`);
    }
    // The Run transitions running -> waiting right before registering the wait.
    if (active.run.status !== 'running' && active.run.status !== 'waiting') {
      throw new Error(`Run ${input.executionId} is not running and cannot wait for approval.`);
    }
    if (active.pendingApproval && !active.pendingApproval.settled) {
      throw new Error(`Run ${input.executionId} already has a pending approval.`);
    }

    let settle!: (resolution: ApprovalResolution) => void;
    const promise = new Promise<ApprovalResolution>((resolve) => {
      settle = resolve;
    });
    active.pendingApproval = {
      approvalId: input.approval.runApprovalId,
      approval: snapshot(input.approval),
      promise,
      settle,
      settled: false,
    };
    return promise;
  }

  /** Settles the pending approval wait; returns whether the decision was accepted. */
  resolveApproval(input: {
    readonly approvalId: string;
    readonly decision: ApprovalDecision;
  }): ResolveApprovalResult {
    const active = [...this.activeRuns.values()].find(
      (candidate) => candidate.pendingApproval?.approvalId === input.approvalId,
    );
    if (!active || !active.pendingApproval) return { status: 'not_found' };
    const pending = active.pendingApproval;
    if (pending.settled) return { status: 'already_resolved', run: snapshot(active.run) };
    if (active.run.status !== 'waiting') return { status: 'not_waiting', run: snapshot(active.run) };

    pending.settled = true;
    pending.settle(
      input.decision.decision === 'approved'
        ? { status: 'approved', decision: snapshot(input.decision) }
        : { status: 'denied', decision: snapshot(input.decision) },
    );
    return { status: 'accepted', run: snapshot(active.run) };
  }

  /** Settles the pending approval wait as cancelled, e.g. when the Run is cancelled. */
  cancelPendingApproval(executionId: string): boolean {
    const active = this.activeRuns.get(executionId);
    const pending = active?.pendingApproval;
    if (!pending || pending.settled) return false;
    pending.settled = true;
    pending.settle({ status: 'cancelled' });
    return true;
  }

  /** Cancels the pending approval wait when the Run reaches a terminal state. */
  private settlePendingApprovalCancelled(run: Run): void {
    const active = this.activeRuns.get(run.executionId);
    const pending = active?.pendingApproval;
    if (!pending || pending.settled) return;
    pending.settled = true;
    pending.settle({ status: 'cancelled' });
  }

  private notifyIdle(): void {
    if ([...this.activeRuns.values()].some((active) => !isTerminalRunStatus(active.run.status))) {
      return;
    }
    for (const waiter of [...this.idleWaiters]) waiter();
  }

  private pruneExpired(): void {
    const nowMs = this.nowMs();
    for (const [requestId, record] of this.requestRecords) {
      if (
        record.status !== 'started'
        || record.expiresAtMs === undefined
        || record.expiresAtMs > nowMs
      ) {
        continue;
      }
      this.requestRecords.delete(requestId);
      this.terminalRuns.delete(record.result.run.executionId);
    }
  }

  private nowMs(): number {
    const value = Date.parse(this.options.clock.now());
    if (!Number.isFinite(value)) {
      throw new Error('RunClock.now() must return a valid timestamp.');
    }
    return value;
  }
}

function sameFingerprint(
  left: StartRequestFingerprint,
  right: StartRequestFingerprint,
): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.parentEntryId === right.parentEntryId
    && left.inputDigest === right.inputDigest;
}

function assertReservationMatchesRun(input: {
  readonly requestId: string;
  readonly fingerprint: StartRequestFingerprint;
  readonly run: Run;
}): void {
  if (
    input.run.requestId !== input.requestId
    || input.run.workspaceId !== input.fingerprint.workspaceId
    || input.run.sessionId !== input.fingerprint.sessionId
    || input.run.parentEntryId !== input.fingerprint.parentEntryId
  ) {
    throw new Error('Start reservation identity does not match the Run.');
  }
}

function snapshot<T>(value: T): T {
  return structuredClone(value);
}
