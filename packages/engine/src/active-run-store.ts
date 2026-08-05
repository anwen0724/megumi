/*
 * Owns the only mutable per-Run runtime record: the ActiveRun. It keeps the
 * Run snapshot, the root AbortController, the single Agent Loop completion
 * and at most one pending approval wait. Request-id idempotency, per-Session
 * exclusion, and bounded terminal results live here too; no router,
 * continuation, stream buffer or loop position ever does.
 */
import type { SessionEntry, SessionMessageWithAttachments } from '@megumi/session';
import type { ApprovalDecision } from '@megumi/permissions';
import type { EngineClock, RunApproval } from './engine';
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
 * a Tool Call continuation, remaining calls, stream output, attempt state
 * or any Agent Loop execution position.
 */
export interface ActiveRun {
  run: Run;
  readonly abortController: AbortController;
  /** Settled exactly once when the single Agent Loop call converges. */
  readonly completion: Promise<void>;
  pendingApproval?: PendingApproval;
}

export type ResolveApprovalResult =
  | { readonly status: 'accepted'; readonly run: Run }
  | { readonly status: 'not_found' }
  | { readonly status: 'not_waiting'; readonly run: Run }
  | { readonly status: 'already_resolved'; readonly run: Run };

export interface ActiveRunStoreOptions {
  readonly clock: EngineClock;
  readonly terminalRunRetentionMs: number;
}

export class ActiveRunStore {
  private readonly requestRecords = new Map<string, RequestRecord>();
  /** Runs reserved but not yet attached to an ActiveRun (start establishment in flight). */
  private readonly pendingRuns = new Map<string, Run>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly terminalRuns = new Map<string, Run>();
  private readonly runIdBySession = new Map<string, string>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly options: ActiveRunStoreOptions) {
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

    const activeRunId = this.runIdBySession.get(input.fingerprint.sessionId);
    if (activeRunId) {
      const run = this.findLiveRun(activeRunId);
      if (run && !isTerminalRunStatus(run.status)) {
        return { status: 'session_busy', activeRun: run };
      }
      this.runIdBySession.delete(input.fingerprint.sessionId);
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
    this.pendingRuns.set(input.run.runId, input.run);
    this.runIdBySession.set(input.run.sessionId, input.run.runId);
    return { status: 'reserved', run: input.run };
  }

  completeStart(input: {
    readonly requestId: string;
    readonly result: StoredStartResult;
  }): void {
    const record = this.requestRecords.get(input.requestId);
    if (!record || record.status !== 'pending') {
      throw new Error(`No pending Engine start for request ${input.requestId}.`);
    }
    if (record.run.runId !== input.result.run.runId) {
      throw new Error('Completed Engine start does not match its reserved Run.');
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
      throw new Error(`No pending Engine start for request ${input.requestId}.`);
    }

    this.requestRecords.delete(input.requestId);
    this.pendingRuns.delete(record.run.runId);
    if (this.runIdBySession.get(record.run.sessionId) === record.run.runId) {
      this.runIdBySession.delete(record.run.sessionId);
    }
    record.settle({ status: 'failed', failure: input.failure });
    this.notifyIdle();
  }

  /** Registers the single ActiveRun for a started Run. */
  attachActiveRun(activeRun: ActiveRun): void {
    const run = activeRun.run;
    const existing = this.activeRuns.get(run.runId);
    if (existing) {
      throw new Error(`Run already has an ActiveRun: ${run.runId}.`);
    }
    this.pendingRuns.delete(run.runId);
    this.activeRuns.set(run.runId, activeRun);
    this.runIdBySession.set(run.sessionId, run.runId);
  }

  getActiveRun(runId: string): ActiveRun | undefined {
    return this.activeRuns.get(runId);
  }

  updateRun(run: Run): void {
    this.pruneExpired();
    const active = this.activeRuns.get(run.runId);
    if (!active) {
      // A reserved Run may settle directly to a terminal result without a loop.
      const pending = this.pendingRuns.get(run.runId);
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
          this.pendingRuns.delete(run.runId);
          this.terminalRuns.set(run.runId, run);
          this.notifyIdle();
        } else {
          this.pendingRuns.set(run.runId, run);
        }
        return;
      }
      const previous = this.terminalRuns.get(run.runId);
      if (previous && isTerminalRunStatus(run.status)) {
        this.terminalRuns.set(run.runId, run);
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
      if (this.runIdBySession.get(run.sessionId) === run.runId) {
        this.runIdBySession.delete(run.sessionId);
      }
      this.settlePendingApprovalCancelled(run);
      this.activeRuns.delete(run.runId);
      this.terminalRuns.set(run.runId, run);
      this.notifyIdle();
    }
  }

  getRun(runId: string): Run | undefined {
    this.pruneExpired();
    const live = this.findLiveRun(runId);
    if (live) return snapshot(live);
    const terminal = this.terminalRuns.get(runId);
    return terminal ? snapshot(terminal) : undefined;
  }

  private findLiveRun(runId: string): Run | undefined {
    const active = this.activeRuns.get(runId);
    if (active) return active.run;
    return this.pendingRuns.get(runId);
  }

  getActiveRunForSession(sessionId: string): Run | undefined {
    this.pruneExpired();
    const runId = this.runIdBySession.get(sessionId);
    if (!runId) return undefined;
    const active = this.activeRuns.get(runId);
    return active ? snapshot(active.run) : undefined;
  }

  listActiveRuns(): readonly Run[] {
    this.pruneExpired();
    return [...this.activeRuns.values()]
      .map((active) => snapshot(active.run))
      .filter((run) => !isTerminalRunStatus(run.status));
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError('Engine idle timeout must be a non-negative number.');
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
   * promise. The Agent Loop awaits it in place; the Engine settles it.
   */
  beginApprovalWait(input: {
    readonly runId: string;
    readonly approval: RunApproval;
  }): Promise<ApprovalResolution> {
    const active = this.activeRuns.get(input.runId);
    if (!active || isTerminalRunStatus(active.run.status)) {
      throw new Error(`Cannot wait for approval on inactive Run ${input.runId}.`);
    }
    // The Run transitions running -> waiting right before registering the wait.
    if (active.run.status !== 'running' && active.run.status !== 'waiting') {
      throw new Error(`Run ${input.runId} is not running and cannot wait for approval.`);
    }
    if (active.pendingApproval && !active.pendingApproval.settled) {
      throw new Error(`Run ${input.runId} already has a pending approval.`);
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
  cancelPendingApproval(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    const pending = active?.pendingApproval;
    if (!pending || pending.settled) return false;
    pending.settled = true;
    pending.settle({ status: 'cancelled' });
    return true;
  }

  /** Cancels the pending approval wait when the Run reaches a terminal state. */
  private settlePendingApprovalCancelled(run: Run): void {
    const active = this.activeRuns.get(run.runId);
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
      this.terminalRuns.delete(record.result.run.runId);
    }
  }

  private nowMs(): number {
    const value = Date.parse(this.options.clock.now());
    if (!Number.isFinite(value)) {
      throw new Error('EngineClock.now() must return a valid timestamp.');
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
