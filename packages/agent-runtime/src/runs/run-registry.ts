/* Owns run admission, cancellation, approval waits, session occupancy and terminal outcomes. */
import type { RunLoopController } from './loop';
import type { Api, Model } from '@megumi/ai';
import type {
  ApprovalDecision,
  ApprovalOption,
  PermissionMode,
  PermissionOperation,
} from '../permissions/index';
import type { SessionEntry, SessionMessageWithAttachments } from '../sessions/index';
import type { ToolIdentity } from '../tools/index';

// ---------------------------------------------------------------------------
// Internal execution records
// ---------------------------------------------------------------------------

export interface BaseExecutionMetadata {
  readonly executionId: string;
  readonly requestId: string;
  readonly model: Model<Api>;
  readonly createdAt: string;
  readonly startedAt: string;
}

export interface ConversationExecutionMetadata extends BaseExecutionMetadata {
  readonly kind: 'conversation';
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly userMessageId: string;
  readonly permissionMode: PermissionMode;
}

export interface RecommendationExecutionMetadata extends BaseExecutionMetadata {
  readonly kind: 'recommendation';
  readonly localDate: string;
}

export interface CandidateSupplyExecutionMetadata extends BaseExecutionMetadata {
  readonly kind: 'candidate_supply';
}

export type ExecutionMetadata = ConversationExecutionMetadata | RecommendationExecutionMetadata
  | CandidateSupplyExecutionMetadata;

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
 * the loop cancellation handle, completion and at most one approval wait.
 * Run status is owned here, independently of internal loop progress.
 */
export interface ActiveExecution {
  readonly metadata: ExecutionMetadata;
  readonly agent: Pick<RunLoopController, 'abort'>;
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
      readonly assistantMessageId?: string;
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
 * derived from this registry's admission, cancellation, approval and terminal records.
 */
export type ExecutionStatus =
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExecutionSnapshot = ExecutionMetadata & {
  readonly status: ExecutionStatus;
  readonly completedAt?: string;
  readonly failure?: ExecutionFailure;
};

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
  readonly execution: Extract<ExecutionSnapshot, { kind: 'conversation' }>;
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
  | { readonly status: 'session_busy'; readonly activeExecution: Extract<ExecutionSnapshot, { kind: 'conversation' }> };

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

export interface RunRegistryOptions {
  readonly clock: ExecutionClock;
  readonly terminalRetentionMs: number;
}

export class RunRegistry {
  private readonly cancellationControllers = new Map<string, AbortController>();
  private readonly requestRecords = new Map<string, RequestRecord>();
  /** Executions reserved but not yet attached to an ActiveExecution. */
  private readonly pendingExecutions = new Map<string, ExecutionMetadata>();
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private readonly terminalExecutions = new Map<string, TerminalExecution>();
  private readonly executionIdBySession = new Map<string, string>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly options: RunRegistryOptions) {
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
    readonly metadata: ConversationExecutionMetadata;
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
        const activeExecution = this.snapshotLive(execution);
        if (activeExecution.kind === 'conversation') {
          return { status: 'session_busy', activeExecution };
        }
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
    this.cancellationControllers.set(input.metadata.executionId, new AbortController());
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
    this.cancellationControllers.delete(record.executionId);
    if (metadata?.kind === 'conversation'
      && this.executionIdBySession.get(metadata.sessionId) === metadata.executionId) {
      this.executionIdBySession.delete(metadata.sessionId);
    }
    record.settle({ status: 'failed', failure: snapshot(input.failure) });
    this.notifyIdle();
  }

  /** Reserves a background run while its execution dependencies are prepared. */
  reserveBackground(metadata: RecommendationExecutionMetadata | CandidateSupplyExecutionMetadata): void {
    if (this.findLiveExecution(metadata.executionId) || this.terminalExecutions.has(metadata.executionId)) {
      throw new Error('A run with this identity already exists.');
    }
    this.pendingExecutions.set(metadata.executionId, snapshot(metadata));
    this.cancellationControllers.set(metadata.executionId, new AbortController());
  }

  /** Releases a background reservation whose launch did not complete. */
  failBackgroundStart(executionId: string): void {
    this.pendingExecutions.delete(executionId);
    this.cancellationControllers.delete(executionId);
    this.notifyIdle();
  }

  /** Provides one cancellation signal for admission, execution and cleanup. */
  getCancellationSignal(executionId: string): AbortSignal | undefined {
    return this.cancellationControllers.get(executionId)?.signal;
  }

  /** Requests cancellation even before a run has attached its loop. */
  requestCancellation(executionId: string): void {
    this.cancelPendingApproval(executionId);
    this.cancellationControllers.get(executionId)?.abort();
    this.activeExecutions.get(executionId)?.agent.abort();
  }

  /** Registers the single ActiveExecution for a reserved execution. */
  attachActiveExecution(active: ActiveExecution): void {
    const executionId = active.metadata.executionId;
    if (this.activeExecutions.has(executionId)) {
      throw new Error(`Execution already has an ActiveExecution: ${executionId}.`);
    }
    this.pendingExecutions.delete(executionId);
    if (!this.cancellationControllers.has(executionId)) this.cancellationControllers.set(executionId, new AbortController());
    this.activeExecutions.set(executionId, {
      metadata: snapshot(active.metadata),
      agent: active.agent,
      completion: active.completion,
      pendingApproval: active.pendingApproval,
    });
    if (active.metadata.kind === 'conversation') {
      this.executionIdBySession.set(active.metadata.sessionId, executionId);
    }
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
    if (active.metadata.kind === 'conversation'
      && this.executionIdBySession.get(active.metadata.sessionId) === executionId) {
      this.executionIdBySession.delete(active.metadata.sessionId);
    }
    this.activeExecutions.delete(executionId);
    this.cancellationControllers.delete(executionId);
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

  getActive(sessionId: string): Extract<ExecutionSnapshot, { kind: 'conversation' }> | undefined {
    const executionId = this.executionIdBySession.get(sessionId);
    if (!executionId) return undefined;
    const live = this.findLiveExecution(executionId);
    if (!live) {
      this.executionIdBySession.delete(sessionId);
      return undefined;
    }
    const snapshot = this.snapshotLive(live);
    return snapshot.kind === 'conversation' ? snapshot : undefined;
  }

  /** The internal ActiveExecution handle; only the Discovery Agent cancel path reads it. */
  getActiveExecutionHandle(executionId: string): ActiveExecution | undefined {
    return this.activeExecutions.get(executionId);
  }

  getCompletion(executionId: string): Promise<ExecutionOutcome> | undefined {
    const active = this.activeExecutions.get(executionId);
    if (active) return active.completion;
    const terminal = this.terminalExecutions.get(executionId);
    return terminal ? Promise.resolve(snapshot(terminal.outcome)) : undefined;
  }

  listActiveExecutions(): readonly ExecutionSnapshot[] {
    this.pruneExpired();
    return [...this.pendingExecutions.values(), ...this.activeExecutions.values()].map((active) => this.snapshotLive(active));
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError('Execution idle timeout must be a non-negative number.');
    }
    if (this.activeExecutions.size === 0 && this.pendingExecutions.size === 0) return true;
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
    const pendingApproval = 'agent' in live ? live.pendingApproval : undefined;
    let status: ExecutionStatus = pendingApproval && !pendingApproval.settled ? 'waiting' : 'running';
    if (this.cancellationControllers.get(metadata.executionId)?.signal.aborted) status = 'cancelling';
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
    if (!execution || execution.kind !== 'conversation') {
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
    if (this.activeExecutions.size > 0 || this.pendingExecutions.size > 0) return;
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
  readonly metadata: ConversationExecutionMetadata;
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
