/*
 * Owns the Discovery Agent's multi-execution runtime records: request-id
 * reservation, per-Session exclusion, the single ActiveExecution handle per
 * execution, the pending Approval wait, immutable TerminalExecution results,
 * and idle waiting. No Run FSM, status mutation or outer AbortController lives
 * here: live status is derived from the Agent's execution state, and terminal
 * facts are fixed exactly once.
 */
import type { Agent } from '@megumi/agent-core';
import type { Api, Model } from '@megumi/ai';
import type {
  ApprovalDecision,
  ApprovalOption,
  PermissionMode,
  PermissionOperation,
} from '@megumi/permissions';
import type { SessionEntry, SessionMessageWithAttachments } from '@megumi/session';
import type { ToolIdentity } from '@megumi/tools';

// ---------------------------------------------------------------------------
// Internal execution records
// ---------------------------------------------------------------------------

export interface ExecutionMetadata {
  readonly executionId: string;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly userMessageId: string;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
  readonly createdAt: string;
  readonly startedAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly executionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolIdentity: ToolIdentity;
  readonly input: unknown;
  readonly operations: readonly PermissionOperation[];
  readonly options: readonly ApprovalOption[];
  readonly defaultOptionId: string;
  readonly summary?: string;
  readonly preview?: {
    readonly action: string;
    readonly targets: readonly {
      readonly kind: string;
      readonly label: string;
    }[];
  };
  readonly createdAt: string;
  readonly status: ApprovalStatus;
  readonly decidedAt?: string;
  readonly decision?: ApprovalDecision;
}

export type ApprovalResolution =
  | { readonly status: 'approved'; readonly decision: ApprovalDecision }
  | { readonly status: 'denied'; readonly decision: ApprovalDecision }
  | { readonly status: 'cancelled' };

export interface PendingApproval {
  readonly approvalId: string;
  readonly approval: ApprovalRequest;
  readonly promise: Promise<ApprovalResolution>;
  readonly settle: (resolution: ApprovalResolution) => void;
  settled: boolean;
}

/**
 * The only mutable runtime record of one live execution: the external facts,
 * the Agent control handle, the single outcome completion and at most one
 * pending approval wait. It never holds a state enum or an AbortController.
 */
export interface ActiveExecution {
  readonly metadata: ExecutionMetadata;
  readonly agent: Agent;
  readonly completion: Promise<ExecutionOutcome>;
  pendingApproval?: PendingApproval;
}

/** Immutable terminal record: the fixed outcome plus when it was recorded. */
export interface TerminalExecution {
  readonly metadata: ExecutionMetadata;
  readonly outcome: ExecutionOutcome;
  readonly completedAt: string;
}

export type ExecutionOutcome =
  | {
      readonly status: 'completed';
      readonly assistantMessageId: string;
    }
  | {
      readonly status: 'failed';
      readonly failure: ExecutionFailure;
    }
  | {
      readonly status: 'cancelled';
    };

export type ExecutionFailureCode =
  | 'session_failed'
  | 'context_failed'
  | 'model_call_failed'
  | 'permission_failed'
  | 'tool_system_failed'
  | 'loop_limit_exceeded'
  | 'runtime_protocol_violation'
  | 'cancellation_failed'
  | 'internal_error';

export interface ExecutionFailure {
  readonly code: ExecutionFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: {
    readonly owner:
      | 'agent'
      | 'ai'
      | 'context'
      | 'permissions'
      | 'tools'
      | 'session'
      | 'skills'
      | 'workspace'
      | 'instructions'
      | 'discovery-agent';
    readonly code: string;
  };
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * The read-only execution projection handed to callers. The status is always
 * derived: running/cancelling from the Agent state, waiting from the pending
 * approval during executing_tools, and terminal statuses from the fixed outcome.
 */
export type ExecutionStatus =
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExecutionSnapshot {
  readonly executionId: string;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly userMessageId: string;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
  readonly status: ExecutionStatus;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly failure?: ExecutionFailure;
}

// ---------------------------------------------------------------------------
// Registry records
// ---------------------------------------------------------------------------

export interface StartRequestFingerprint {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly inputDigest: string;
}

export interface StoredStartResult {
  readonly execution: ExecutionSnapshot;
  readonly userMessage: SessionMessageWithAttachments;
  readonly userEntry: SessionEntry;
}

export type StartEstablishmentCompletion =
  | { readonly status: 'started'; readonly result: StoredStartResult }
  | { readonly status: 'failed'; readonly failure: ExecutionFailure };

export type ReserveStartResult =
  | { readonly status: 'reserved'; readonly executionId: string }
  | {
      readonly status: 'pending';
      readonly completion: Promise<StartEstablishmentCompletion>;
    }
  | { readonly status: 'already_started'; readonly result: StoredStartResult }
  | { readonly status: 'request_conflict' }
  | { readonly status: 'session_busy'; readonly activeExecution: ExecutionSnapshot };

interface PendingStartRecord {
  readonly status: 'pending';
  readonly fingerprint: StartRequestFingerprint;
  readonly executionId: string;
  readonly completion: Promise<StartEstablishmentCompletion>;
  readonly settle: (completion: StartEstablishmentCompletion) => void;
}

interface StartedRecord {
  readonly status: 'started';
  readonly fingerprint: StartRequestFingerprint;
  readonly executionId: string;
  readonly userMessage: SessionMessageWithAttachments;
  readonly userEntry: SessionEntry;
  readonly expiresAtMs?: number;
}

type RequestRecord = PendingStartRecord | StartedRecord;

export type ResolveApprovalResult =
  | { readonly status: 'accepted'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found' }
  | { readonly status: 'not_waiting'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'already_resolved'; readonly execution: ExecutionSnapshot };

export interface ExecutionClock {
  now(): string;
}

export interface ExecutionRegistryOptions {
  readonly clock: ExecutionClock;
  readonly terminalRetentionMs: number;
}

export class ExecutionRegistry {
  private readonly requestRecords = new Map<string, RequestRecord>();
  /** Executions reserved but not yet attached to an ActiveExecution. */
  private readonly pendingExecutions = new Map<string, ExecutionMetadata>();
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private readonly terminalExecutions = new Map<string, TerminalExecution>();
  private readonly executionIdBySession = new Map<string, string>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly options: ExecutionRegistryOptions) {
    if (
      !Number.isInteger(options.terminalRetentionMs)
      || options.terminalRetentionMs <= 0
    ) {
      throw new TypeError('terminalRetentionMs must be a positive integer.');
    }
  }

  reserveStart(input: {
    readonly requestId: string;
    readonly fingerprint: StartRequestFingerprint;
    readonly metadata: ExecutionMetadata;
  }): ReserveStartResult {
    this.pruneExpired();
    const existingRequest = this.requestRecords.get(input.requestId);
    if (existingRequest) {
      if (!sameFingerprint(existingRequest.fingerprint, input.fingerprint)) {
        return { status: 'request_conflict' };
      }
      if (existingRequest.status === 'pending') {
        return { status: 'pending', completion: existingRequest.completion };
      }
      return { status: 'already_started', result: this.storedResult(existingRequest) };
    }

    const activeExecutionId = this.executionIdBySession.get(input.fingerprint.sessionId);
    if (activeExecutionId) {
      const execution = this.findLiveExecution(activeExecutionId);
      if (execution) {
        return { status: 'session_busy', activeExecution: this.snapshotLive(execution) };
      }
      this.executionIdBySession.delete(input.fingerprint.sessionId);
    }

    assertReservationMatchesMetadata(input);
    let settle!: (completion: StartEstablishmentCompletion) => void;
    const completion = new Promise<StartEstablishmentCompletion>((resolve) => {
      settle = resolve;
    });
    this.requestRecords.set(input.requestId, {
      status: 'pending',
      fingerprint: snapshot(input.fingerprint),
      executionId: input.metadata.executionId,
      completion,
      settle,
    });
    this.pendingExecutions.set(input.metadata.executionId, snapshot(input.metadata));
    this.executionIdBySession.set(input.metadata.sessionId, input.metadata.executionId);
    return { status: 'reserved', executionId: input.metadata.executionId };
  }

  completeStart(input: {
    readonly requestId: string;
    readonly executionId: string;
    readonly userMessage: SessionMessageWithAttachments;
    readonly userEntry: SessionEntry;
  }): void {
    const record = this.requestRecords.get(input.requestId);
    if (!record || record.status !== 'pending') {
      throw new Error(`No pending execution start for request ${input.requestId}.`);
    }
    if (record.executionId !== input.executionId) {
      throw new Error('Completed execution start does not match its reserved execution.');
    }
    const startedRecord: StartedRecord = {
      status: 'started',
      fingerprint: record.fingerprint,
      executionId: record.executionId,
      userMessage: structuredClone(input.userMessage),
      userEntry: structuredClone(input.userEntry),
    };
    this.requestRecords.set(input.requestId, startedRecord);
    record.settle({ status: 'started', result: this.storedResult(startedRecord) });
  }

  failStart(input: { readonly requestId: string; readonly failure: ExecutionFailure }): void {
    const record = this.requestRecords.get(input.requestId);
    if (!record || record.status !== 'pending') {
      throw new Error(`No pending execution start for request ${input.requestId}.`);
    }
    this.requestRecords.delete(input.requestId);
    const metadata = this.pendingExecutions.get(record.executionId);
    this.pendingExecutions.delete(record.executionId);
    if (metadata && this.executionIdBySession.get(metadata.sessionId) === metadata.executionId) {
      this.executionIdBySession.delete(metadata.sessionId);
    }
    record.settle({ status: 'failed', failure: snapshot(input.failure) });
    this.notifyIdle();
  }

  /** Registers the single ActiveExecution for a reserved execution. */
  attachActiveExecution(active: ActiveExecution): void {
    const executionId = active.metadata.executionId;
    if (this.activeExecutions.has(executionId)) {
      throw new Error(`Execution already has an ActiveExecution: ${executionId}.`);
    }
    this.pendingExecutions.delete(executionId);
    this.activeExecutions.set(executionId, {
      metadata: snapshot(active.metadata),
      agent: active.agent,
      completion: active.completion,
      pendingApproval: active.pendingApproval,
    });
    this.executionIdBySession.set(active.metadata.sessionId, executionId);
  }

  /** Fixes the immutable terminal record and releases every held resource. */
  settleTerminal(executionId: string, outcome: ExecutionOutcome): void {
    const active = this.activeExecutions.get(executionId);
    if (!active) return;
    const terminal: TerminalExecution = {
      metadata: snapshot(active.metadata),
      outcome: snapshot(outcome),
      completedAt: this.options.clock.now(),
    };
    // Terminal settlement releases every resource independently: a pending
    // approval, the Session occupancy and the active record.
    this.settlePendingApprovalCancelled(active);
    if (this.executionIdBySession.get(active.metadata.sessionId) === executionId) {
      this.executionIdBySession.delete(active.metadata.sessionId);
    }
    this.activeExecutions.delete(executionId);
    this.terminalExecutions.set(executionId, terminal);
    const record = this.requestRecords.get(active.metadata.requestId);
    if (record?.status === 'started' && record.executionId === executionId) {
      this.requestRecords.set(active.metadata.requestId, {
        ...record,
        expiresAtMs: this.nowMs() + this.options.terminalRetentionMs,
      });
    }
    this.notifyIdle();
  }

  getExecution(executionId: string): ExecutionSnapshot | undefined {
    this.pruneExpired();
    const live = this.findLiveExecution(executionId);
    if (live) return this.snapshotLive(live);
    const terminal = this.terminalExecutions.get(executionId);
    return terminal ? this.snapshotTerminal(terminal) : undefined;
  }

  getActive(sessionId: string): ExecutionSnapshot | undefined {
    const executionId = this.executionIdBySession.get(sessionId);
    if (!executionId) return undefined;
    const live = this.findLiveExecution(executionId);
    if (!live) {
      this.executionIdBySession.delete(sessionId);
      return undefined;
    }
    return this.snapshotLive(live);
  }

  /** The internal ActiveExecution handle; only the Discovery Agent cancel path reads it. */
  getActiveExecutionHandle(executionId: string): ActiveExecution | undefined {
    return this.activeExecutions.get(executionId);
  }

  listActiveExecutions(): readonly ExecutionSnapshot[] {
    this.pruneExpired();
    return [...this.activeExecutions.values()].map((active) => this.snapshotLive(active));
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError('Execution idle timeout must be a non-negative number.');
    }
    if (this.activeExecutions.size === 0) return true;
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
    return record?.status === 'started' ? this.storedResult(record) : undefined;
  }

  /**
   * Registers the one pending approval wait of an active execution and returns
   * its promise. The Tool Adapter awaits it in place; the public resolve/cancel
   * operations settle it.
   */
  beginApprovalWait(input: {
    readonly executionId: string;
    readonly approval: ApprovalRequest;
  }): Promise<ApprovalResolution> {
    const active = this.activeExecutions.get(input.executionId);
    if (!active) {
      throw new Error(`Cannot wait for approval on inactive execution ${input.executionId}.`);
    }
    if (active.pendingApproval && !active.pendingApproval.settled) {
      throw new Error(`Execution ${input.executionId} already has a pending approval.`);
    }
    let settle!: (resolution: ApprovalResolution) => void;
    const promise = new Promise<ApprovalResolution>((resolve) => {
      settle = resolve;
    });
    active.pendingApproval = {
      approvalId: input.approval.approvalId,
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
    const active = [...this.activeExecutions.values()].find(
      (candidate) => candidate.pendingApproval?.approvalId === input.approvalId,
    );
    if (!active || !active.pendingApproval) return { status: 'not_found' };
    const pending = active.pendingApproval;
    const execution = this.snapshotLive(active);
    if (pending.settled) return { status: 'already_resolved', execution };
    if (execution.status !== 'waiting') return { status: 'not_waiting', execution };

    pending.settled = true;
    pending.settle(
      input.decision.decision === 'approved'
        ? { status: 'approved', decision: snapshot(input.decision) }
        : { status: 'denied', decision: snapshot(input.decision) },
    );
    return { status: 'accepted', execution };
  }

  /** Settles the pending approval wait as cancelled, e.g. when the execution is cancelled. */
  cancelPendingApproval(executionId: string): boolean {
    const active = this.activeExecutions.get(executionId);
    const pending = active?.pendingApproval;
    if (!pending || pending.settled) return false;
    pending.settled = true;
    pending.settle({ status: 'cancelled' });
    return true;
  }

  private settlePendingApprovalCancelled(active: ActiveExecution): void {
    const pending = active.pendingApproval;
    if (!pending || pending.settled) return;
    pending.settled = true;
    pending.settle({ status: 'cancelled' });
  }

  private snapshotLive(live: ActiveExecution | ExecutionMetadata): ExecutionSnapshot {
    const metadata = 'agent' in live ? live.metadata : live;
    const agent = 'agent' in live ? live.agent : undefined;
    const pendingApproval = 'agent' in live ? live.pendingApproval : undefined;
    let status: ExecutionStatus = 'running';
    if (agent) {
      const execution = agent.state.execution;
      if (execution.status === 'cancelling') status = 'cancelling';
      else if (
        pendingApproval
        && !pendingApproval.settled
        && execution.status === 'executing'
        && execution.phase === 'executing_tools'
      ) {
        status = 'waiting';
      }
    }
    return { ...snapshot(metadata), status };
  }

  private snapshotTerminal(terminal: TerminalExecution): ExecutionSnapshot {
    const outcome = terminal.outcome;
    return {
      ...snapshot(terminal.metadata),
      status: outcome.status,
      completedAt: terminal.completedAt,
      ...(outcome.status === 'failed' ? { failure: snapshot(outcome.failure) } : {}),
    };
  }

  private storedResult(record: StartedRecord): StoredStartResult {
    const execution = this.getExecution(record.executionId);
    if (!execution) {
      throw new Error(`Started request ${record.executionId} has no live or terminal execution.`);
    }
    return {
      execution,
      userMessage: structuredClone(record.userMessage),
      userEntry: structuredClone(record.userEntry),
    };
  }

  private findLiveExecution(executionId: string): ActiveExecution | ExecutionMetadata | undefined {
    return this.activeExecutions.get(executionId) ?? this.pendingExecutions.get(executionId);
  }

  private notifyIdle(): void {
    if (this.activeExecutions.size > 0) return;
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
      this.terminalExecutions.delete(record.executionId);
    }
  }

  private nowMs(): number {
    const value = Date.parse(this.options.clock.now());
    if (!Number.isFinite(value)) {
      throw new Error('ExecutionClock.now() must return a valid timestamp.');
    }
    return value;
  }
}

function sameFingerprint(left: StartRequestFingerprint, right: StartRequestFingerprint): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.parentEntryId === right.parentEntryId
    && left.inputDigest === right.inputDigest;
}

function assertReservationMatchesMetadata(input: {
  readonly requestId: string;
  readonly fingerprint: StartRequestFingerprint;
  readonly metadata: ExecutionMetadata;
}): void {
  if (
    input.metadata.requestId !== input.requestId
    || input.metadata.workspaceId !== input.fingerprint.workspaceId
    || input.metadata.sessionId !== input.fingerprint.sessionId
    || input.metadata.parentEntryId !== input.fingerprint.parentEntryId
  ) {
    throw new Error('Start reservation identity does not match the execution metadata.');
  }
}

function snapshot<T>(value: T): T {
  return structuredClone(value);
}
