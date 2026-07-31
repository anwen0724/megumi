/*
 * Owns in-process Run identity, per-Session exclusion, and bounded terminal summaries.
 */
import type { SessionEntry, SessionMessageWithAttachments } from '@megumi/agent/session';
import type { ApprovalDecision } from '@megumi/agent/permissions';
import type { EngineClock, RunApproval } from './engine';
import type { Run, RunFailure } from './run';
import type { EngineRunRuntime } from './run-loop';
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

export interface StoredRunApproval<TContinuation = unknown> {
  readonly approval: RunApproval;
  readonly continuation?: TContinuation;
  readonly claimed: boolean;
}

interface MutableRunApprovalRecord<TContinuation = unknown> {
  approval: RunApproval;
  continuation?: TContinuation;
  claimed: boolean;
}

export interface ClaimedRunApproval<TContinuation> extends StoredRunApproval<TContinuation> {
  readonly continuation: TContinuation;
  readonly claimed: true;
}

export type PutRunApprovalResult =
  | { readonly status: 'stored' }
  | { readonly status: 'already_exists'; readonly approval: RunApproval }
  | { readonly status: 'run_already_waiting'; readonly approval: RunApproval };

export type ClaimRunApprovalResult<TContinuation = unknown> =
  | { readonly status: 'claimed'; readonly record: ClaimedRunApproval<TContinuation> }
  | { readonly status: 'not_found' }
  | { readonly status: 'already_claimed'; readonly approval: RunApproval }
  | { readonly status: 'already_resolved'; readonly approval: RunApproval };

export interface ActiveRunStoreOptions {
  readonly clock: EngineClock;
  readonly terminalRunRetentionMs: number;
}

export class ActiveRunStore {
  private readonly requestRecords = new Map<string, RequestRecord>();
  private readonly runsById = new Map<string, Run>();
  private readonly runIdBySession = new Map<string, string>();
  private readonly runApprovals = new Map<string, MutableRunApprovalRecord>();
  private readonly pendingApprovalIdByRun = new Map<string, string>();
  private readonly runIdByToolExecution = new Map<string, string>();
  private readonly activeToolExecutionIdsByRun = new Map<string, Set<string>>();
  private readonly runtimeByRunId = new Map<string, EngineRunRuntime>();

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
      const activeRun = this.runsById.get(activeRunId);
      if (activeRun && !isTerminalRunStatus(activeRun.status)) {
        return { status: 'session_busy', activeRun };
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
    this.runsById.set(input.run.runId, input.run);
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
    this.runsById.set(input.result.run.runId, input.result.run);
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
    this.runsById.delete(record.run.runId);
    if (this.runIdBySession.get(record.run.sessionId) === record.run.runId) {
      this.runIdBySession.delete(record.run.sessionId);
    }
    record.settle({ status: 'failed', failure: input.failure });
  }

  updateRun(run: Run): void {
    this.pruneExpired();
    const previous = this.runsById.get(run.runId);
    if (!previous) {
      throw new Error(`Run not found: ${run.runId}.`);
    }
    if (previous.requestId !== run.requestId || previous.sessionId !== run.sessionId) {
      throw new Error('Updated Run identity does not match the stored Run.');
    }

    this.runsById.set(run.runId, run);
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
      this.cancelPendingRunApproval({
        runId: run.runId,
        cancelledAt: run.completedAt ?? this.options.clock.now(),
      });
      this.clearActiveToolExecutions(run.runId);
    }
  }

  getRun(runId: string): Run | undefined {
    this.pruneExpired();
    return this.runsById.get(runId);
  }

  getActiveRunForSession(sessionId: string): Run | undefined {
    this.pruneExpired();
    const runId = this.runIdBySession.get(sessionId);
    return runId ? this.runsById.get(runId) : undefined;
  }

  getStartedResult(requestId: string): StoredStartResult | undefined {
    this.pruneExpired();
    const record = this.requestRecords.get(requestId);
    return record?.status === 'started' ? record.result : undefined;
  }

  setRunRuntime(runId: string, runtime: EngineRunRuntime): void {
    const run = this.getRun(runId);
    if (!run || isTerminalRunStatus(run.status)) {
      throw new Error(`Cannot store runtime for inactive Run ${runId}.`);
    }
    if (this.runtimeByRunId.has(runId)) {
      throw new Error(`Run runtime already exists: ${runId}.`);
    }
    this.runtimeByRunId.set(runId, runtime);
  }

  getRunRuntime(runId: string): EngineRunRuntime | undefined {
    return this.runtimeByRunId.get(runId);
  }

  releaseRunRuntime(runId: string): boolean {
    return this.runtimeByRunId.delete(runId);
  }

  putRunApproval<TContinuation>(input: {
    readonly approval: RunApproval;
    readonly continuation: TContinuation;
  }): PutRunApprovalResult {
    const run = this.getRun(input.approval.runId);
    if (!run || isTerminalRunStatus(run.status)) {
      throw new Error(`Cannot store approval for inactive Run ${input.approval.runId}.`);
    }
    if (input.approval.status !== 'pending') {
      throw new Error('A new RunApproval must be pending.');
    }

    const existingById = this.runApprovals.get(input.approval.runApprovalId);
    if (existingById) {
      return {
        status: 'already_exists',
        approval: snapshot(existingById.approval),
      };
    }
    const existingPendingId = this.pendingApprovalIdByRun.get(input.approval.runId);
    if (existingPendingId) {
      const existing = this.runApprovals.get(existingPendingId);
      if (existing?.approval.status === 'pending') {
        return {
          status: 'run_already_waiting',
          approval: snapshot(existing.approval),
        };
      }
      this.pendingApprovalIdByRun.delete(input.approval.runId);
    }

    this.runApprovals.set(input.approval.runApprovalId, {
      approval: snapshot(input.approval),
      continuation: snapshot(input.continuation),
      claimed: false,
    });
    this.pendingApprovalIdByRun.set(input.approval.runId, input.approval.runApprovalId);
    return { status: 'stored' };
  }

  getRunApproval<TContinuation = unknown>(
    runApprovalId: string,
  ): StoredRunApproval<TContinuation> | undefined {
    const record = this.runApprovals.get(runApprovalId);
    return record
      ? {
          approval: snapshot(record.approval),
          ...(record.continuation === undefined
            ? {}
            : { continuation: snapshot(record.continuation) as TContinuation }),
          claimed: record.claimed,
        }
      : undefined;
  }

  getPendingRunApproval(runId: string): RunApproval | undefined {
    const runApprovalId = this.pendingApprovalIdByRun.get(runId);
    if (!runApprovalId) return undefined;
    const record = this.runApprovals.get(runApprovalId);
    return record?.approval.status === 'pending'
      ? snapshot(record.approval)
      : undefined;
  }

  claimRunApproval<TContinuation = unknown>(
    runApprovalId: string,
  ): ClaimRunApprovalResult<TContinuation> {
    const record = this.runApprovals.get(runApprovalId);
    if (!record) return { status: 'not_found' };
    if (record.approval.status !== 'pending') {
      return {
        status: 'already_resolved',
        approval: snapshot(record.approval),
      };
    }
    if (record.claimed) {
      return {
        status: 'already_claimed',
        approval: snapshot(record.approval),
      };
    }
    if (record.continuation === undefined) {
      throw new Error(`Pending RunApproval has no continuation: ${runApprovalId}.`);
    }
    record.claimed = true;
    return {
      status: 'claimed',
      record: {
        approval: snapshot(record.approval),
        continuation: snapshot(record.continuation) as TContinuation,
        claimed: true,
      },
    };
  }

  releaseRunApprovalClaim(runApprovalId: string): boolean {
    const record = this.runApprovals.get(runApprovalId);
    if (!record || record.approval.status !== 'pending' || !record.claimed) return false;
    record.claimed = false;
    return true;
  }

  resolveRunApproval(input: {
    readonly runApprovalId: string;
    readonly status: Exclude<RunApproval['status'], 'pending'>;
    readonly decidedAt: string;
    readonly decision?: ApprovalDecision;
  }): RunApproval {
    const record = this.runApprovals.get(input.runApprovalId);
    if (!record) throw new Error(`RunApproval not found: ${input.runApprovalId}.`);
    if (record.approval.status !== 'pending') {
      throw new Error(`RunApproval already resolved: ${input.runApprovalId}.`);
    }
    if (!record.claimed) {
      throw new Error(`RunApproval must be claimed before resolution: ${input.runApprovalId}.`);
    }

    record.approval = {
      ...record.approval,
      status: input.status,
      decidedAt: input.decidedAt,
      ...(input.decision ? { decision: snapshot(input.decision) } : {}),
    };
    record.claimed = false;
    record.continuation = undefined;
    if (this.pendingApprovalIdByRun.get(record.approval.runId) === input.runApprovalId) {
      this.pendingApprovalIdByRun.delete(record.approval.runId);
    }
    return snapshot(record.approval);
  }

  cancelPendingRunApproval(input: {
    readonly runId: string;
    readonly cancelledAt: string;
  }): RunApproval | undefined {
    const runApprovalId = this.pendingApprovalIdByRun.get(input.runId);
    if (!runApprovalId) return undefined;
    const record = this.runApprovals.get(runApprovalId);
    if (!record || record.approval.status !== 'pending') {
      this.pendingApprovalIdByRun.delete(input.runId);
      return undefined;
    }
    record.claimed = true;
    return this.resolveRunApproval({
      runApprovalId,
      status: 'cancelled',
      decidedAt: input.cancelledAt,
    });
  }

  addActiveToolExecution(input: {
    readonly runId: string;
    readonly toolExecutionId: string;
  }): void {
    const run = this.getRun(input.runId);
    if (!run || isTerminalRunStatus(run.status)) {
      throw new Error(`Cannot start ToolExecution for inactive Run ${input.runId}.`);
    }
    if (this.runIdByToolExecution.has(input.toolExecutionId)) {
      throw new Error(`ToolExecution already active: ${input.toolExecutionId}.`);
    }
    const executions = this.activeToolExecutionIdsByRun.get(input.runId) ?? new Set<string>();
    executions.add(input.toolExecutionId);
    this.activeToolExecutionIdsByRun.set(input.runId, executions);
    this.runIdByToolExecution.set(input.toolExecutionId, input.runId);
  }

  removeActiveToolExecution(toolExecutionId: string): boolean {
    const runId = this.runIdByToolExecution.get(toolExecutionId);
    if (!runId) return false;
    this.runIdByToolExecution.delete(toolExecutionId);
    const executions = this.activeToolExecutionIdsByRun.get(runId);
    executions?.delete(toolExecutionId);
    if (executions?.size === 0) this.activeToolExecutionIdsByRun.delete(runId);
    return true;
  }

  getActiveToolExecutionIds(runId: string): readonly string[] {
    return [...(this.activeToolExecutionIdsByRun.get(runId) ?? [])];
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
      this.runsById.delete(record.result.run.runId);
      this.deleteRunRuntimeRecords(record.result.run.runId);
    }
  }

  private clearActiveToolExecutions(runId: string): void {
    const executions = this.activeToolExecutionIdsByRun.get(runId);
    if (!executions) return;
    for (const toolExecutionId of executions) {
      this.runIdByToolExecution.delete(toolExecutionId);
    }
    this.activeToolExecutionIdsByRun.delete(runId);
  }

  private deleteRunRuntimeRecords(runId: string): void {
    this.clearActiveToolExecutions(runId);
    this.runtimeByRunId.delete(runId);
    this.pendingApprovalIdByRun.delete(runId);
    for (const [runApprovalId, record] of this.runApprovals) {
      if (record.approval.runId === runId) this.runApprovals.delete(runApprovalId);
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
