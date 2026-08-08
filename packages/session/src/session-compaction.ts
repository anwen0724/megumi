/* Owns the persisted Session Compaction lifecycle and its terminal-state invariants. */
import type { SessionCompactionSummary, SessionEntry } from './session-entry-graph';
import { sessionFailure, type SessionFailure } from './session';
import type { SessionStore } from './session-store';

export const SESSION_COMPACTION_TRIGGERS = [
  'threshold',
  'overflow',
  'manual',
  'legacy',
] as const;

export const SESSION_COMPACTION_STATUSES = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export type SessionCompactionTrigger = typeof SESSION_COMPACTION_TRIGGERS[number];
export type SessionCompactionStatus = typeof SESSION_COMPACTION_STATUSES[number];

export interface SessionCompactionError {
  readonly code: string;
  readonly message: string;
}

export interface SessionCompactionRecord {
  readonly compactionId: string;
  readonly sessionId: string;
  readonly anchorEntryId: string;
  readonly trigger: SessionCompactionTrigger;
  readonly status: SessionCompactionStatus;
  readonly summary?: SessionCompactionSummary;
  readonly error?: SessionCompactionError;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface BeginCompactionRequest {
  readonly compactionId: string;
  readonly sessionId: string;
  readonly anchorEntryId: string;
  readonly trigger: Exclude<SessionCompactionTrigger, 'legacy'>;
  readonly startedAt: string;
}

export type BeginCompactionResult =
  | { readonly status: 'started'; readonly compaction: SessionCompactionRecord }
  | { readonly status: 'failed'; readonly failure: SessionFailure };

export interface CompleteCompactionRequest {
  readonly compactionId: string;
  readonly sessionId: string;
  readonly summaryText: string;
  readonly coveredUntilEntryId: string;
  readonly firstKeptEntryId?: string;
  readonly usage?: unknown;
  readonly expectedActiveEntryId?: string | null;
  readonly completedAt: string;
  readonly appendToActivePath?: boolean;
}

export type CompleteCompactionResult =
  | {
      readonly status: 'completed';
      readonly compaction: SessionCompactionRecord;
      readonly entry?: SessionEntry;
    }
  | { readonly status: 'failed'; readonly failure: SessionFailure };

export interface EndCompactionRequest {
  readonly compactionId: string;
  readonly sessionId: string;
  readonly status: 'failed' | 'cancelled' | 'interrupted';
  readonly error?: SessionCompactionError;
  readonly completedAt: string;
}

export type EndCompactionResult =
  | { readonly status: 'ended'; readonly compaction: SessionCompactionRecord }
  | { readonly status: 'failed'; readonly failure: SessionFailure };

export interface InterruptRunningCompactionsRequest {
  readonly completedAt: string;
  readonly error?: SessionCompactionError;
}

export type InterruptRunningCompactionsResult =
  | { readonly status: 'completed'; readonly compactions: readonly SessionCompactionRecord[] }
  | { readonly status: 'failed'; readonly failure: SessionFailure };

export interface SessionCompactionLifecycle {
  /** Persists the unique running record before any started event may be published. */
  begin(request: BeginCompactionRequest): BeginCompactionResult;
  /** Atomically commits the Summary, Entry Graph update, active path, and completed record. */
  complete(request: CompleteCompactionRequest): CompleteCompactionResult;
  /** Ends an already-started Compaction without changing the active semantic path. */
  end(request: EndCompactionRequest): EndCompactionResult;
  /** Closes records abandoned by a previous process without inventing runtime events. */
  interruptRunning(
    request: InterruptRunningCompactionsRequest,
  ): InterruptRunningCompactionsResult;
}

export interface CreateSessionCompactionLifecycleOptions {
  readonly store: SessionStore;
  readonly entryId: (input: { kind: 'compaction'; source_id: string }) => string;
}

/** Creates the Session-owned Compaction lifecycle implementation. */
export function createSessionCompactionLifecycle(
  options: CreateSessionCompactionLifecycleOptions,
): SessionCompactionLifecycle {
  return {
    begin: (request) => beginCompaction(options, request),
    complete: (request) => completeCompaction(options, request),
    end: (request) => endCompaction(options.store, request),
    interruptRunning: (request) => interruptRunningCompactions(options.store, request),
  };
}

function beginCompaction(
  options: CreateSessionCompactionLifecycleOptions,
  request: BeginCompactionRequest,
): BeginCompactionResult {
  try {
    const existing = options.store.findCompactionById(request.compactionId);
    const candidate: SessionCompactionRecord = {
      compactionId: request.compactionId,
      sessionId: request.sessionId,
      anchorEntryId: request.anchorEntryId,
      trigger: request.trigger,
      status: 'running',
      startedAt: request.startedAt,
    };
    if (existing) {
      return sameValue(existing, candidate)
        ? { status: 'started', compaction: existing }
        : compactionConflict(request.compactionId);
    }

    const session = options.store.findSessionById(request.sessionId);
    if (!session) return sessionNotFound(request.sessionId);
    const anchor = options.store.findEntryById(request.anchorEntryId);
    if (!anchor || anchor.session_id !== request.sessionId) {
      return failure('invalid_compaction_anchor', 'anchorEntryId must belong to the Session.');
    }
    return { status: 'started', compaction: options.store.insertCompaction(candidate) };
  } catch (error) {
    return sessionFailure(error);
  }
}

function completeCompaction(
  options: CreateSessionCompactionLifecycleOptions,
  request: CompleteCompactionRequest,
): CompleteCompactionResult {
  try {
    const existing = options.store.findCompactionById(request.compactionId);
    if (!existing || existing.sessionId !== request.sessionId) {
      return failure('compaction_not_started', 'Compaction must be started before completion.');
    }

    const summary = summaryFromRequest(request);
    const completed: SessionCompactionRecord = {
      ...existing,
      status: 'completed',
      summary,
      completedAt: request.completedAt,
    };
    if (existing.status === 'completed') {
      if (!sameValue(existing, completed)) return compactionConflict(request.compactionId);
      const entry = options.store.findEntryById(options.entryId({
        kind: 'compaction',
        source_id: request.compactionId,
      }));
      return { status: 'completed', compaction: existing, ...(entry ? { entry } : {}) };
    }
    if (existing.status !== 'running') return compactionConflict(request.compactionId);

    return options.store.runInTransaction<CompleteCompactionResult>(() => {
      const session = options.store.findSessionById(request.sessionId);
      if (!session) return sessionNotFound(request.sessionId);
      if (
        Object.prototype.hasOwnProperty.call(request, 'expectedActiveEntryId')
        && session.active_entry_id !== (request.expectedActiveEntryId ?? undefined)
      ) {
        return failure(
          'active_entry_changed',
          'Session active entry changed while compaction was being prepared.',
        );
      }
      const coveredEntry = options.store.findEntryById(request.coveredUntilEntryId);
      if (!coveredEntry || coveredEntry.session_id !== request.sessionId) {
        return failure(
          'invalid_covered_until_entry',
          'coveredUntilEntryId must belong to the Session.',
        );
      }
      const firstKeptEntry = request.firstKeptEntryId
        ? options.store.findEntryById(request.firstKeptEntryId)
        : undefined;
      if (
        request.firstKeptEntryId
        && (!firstKeptEntry || firstKeptEntry.session_id !== request.sessionId)
      ) {
        return failure('invalid_first_kept_entry', 'firstKeptEntryId must belong to the Session.');
      }

      let entry: SessionEntry | undefined;
      if (request.appendToActivePath) {
        entry = options.store.insertEntry({
          entry_id: options.entryId({ kind: 'compaction', source_id: request.compactionId }),
          session_id: request.sessionId,
          ...(request.firstKeptEntryId
            ? {}
            : session.active_entry_id
              ? { parent_entry_id: session.active_entry_id }
              : {}),
          entry_type: 'compaction',
          compaction_id: request.compactionId,
          created_at: request.completedAt,
        });
        if (request.firstKeptEntryId) {
          options.store.updateEntryParent({
            entry_id: request.firstKeptEntryId,
            parent_entry_id: entry.entry_id,
          });
        }
        if (
          !session.active_entry_id
          || session.active_entry_id === request.coveredUntilEntryId
          || (!request.firstKeptEntryId
            && session.active_entry_id !== request.coveredUntilEntryId)
        ) {
          options.store.updateActiveEntry({
            session_id: request.sessionId,
            active_entry_id: entry.entry_id,
            updated_at: request.completedAt,
          });
        }
      }

      const saved = options.store.updateCompaction(completed);
      if (!saved) return failure('compaction_not_found', 'Compaction record disappeared.');
      return { status: 'completed', compaction: saved, ...(entry ? { entry } : {}) };
    });
  } catch (error) {
    return sessionFailure(error);
  }
}

function endCompaction(
  store: SessionStore,
  request: EndCompactionRequest,
): EndCompactionResult {
  try {
    const existing = store.findCompactionById(request.compactionId);
    if (!existing || existing.sessionId !== request.sessionId) {
      return failure('compaction_not_started', 'Compaction must be started before it can end.');
    }
    const validation = validateTerminalRequest(request);
    if (validation) return validation;
    const terminal: SessionCompactionRecord = {
      ...existing,
      status: request.status,
      ...(request.error ? { error: request.error } : {}),
      completedAt: request.completedAt,
    };
    if (existing.status !== 'running') {
      return sameValue(existing, terminal)
        ? { status: 'ended', compaction: existing }
        : compactionConflict(request.compactionId);
    }
    const saved = store.updateCompaction(terminal);
    return saved
      ? { status: 'ended', compaction: saved }
      : failure('compaction_not_found', 'Compaction record disappeared.');
  } catch (error) {
    return sessionFailure(error);
  }
}

function interruptRunningCompactions(
  store: SessionStore,
  request: InterruptRunningCompactionsRequest,
): InterruptRunningCompactionsResult {
  try {
    const error = request.error ?? {
      code: 'runtime_interrupted',
      message: 'Compaction was interrupted before it reached a terminal state.',
    };
    const interrupted = store.runInTransaction(() => store.listRunningCompactions().map((record) => {
      const updated: SessionCompactionRecord = {
        ...record,
        status: 'interrupted',
        error,
        completedAt: request.completedAt,
      };
      const saved = store.updateCompaction(updated);
      if (!saved) throw new Error(`Compaction ${record.compactionId} disappeared during recovery.`);
      return saved;
    }));
    return { status: 'completed', compactions: interrupted };
  } catch (error) {
    return sessionFailure(error);
  }
}

function summaryFromRequest(request: CompleteCompactionRequest): SessionCompactionSummary {
  return {
    compaction_id: request.compactionId,
    session_id: request.sessionId,
    summary_text: request.summaryText,
    covered_until_entry_id: request.coveredUntilEntryId,
    ...(request.firstKeptEntryId ? { first_kept_entry_id: request.firstKeptEntryId } : {}),
    ...(request.usage ? { usage: request.usage } : {}),
    created_at: request.completedAt,
  };
}

function validateTerminalRequest(
  request: EndCompactionRequest,
): Extract<EndCompactionResult, { status: 'failed' }> | undefined {
  if ((request.status === 'failed' || request.status === 'interrupted') && !request.error) {
    return failure(
      'compaction_error_required',
      `${request.status} Compaction requires a structured error.`,
    );
  }
  if (request.status === 'cancelled' && request.error) {
    return failure('compaction_error_forbidden', 'Cancelled Compaction must not contain an error.');
  }
  return undefined;
}

function compactionConflict(
  compactionId: string,
): Extract<BeginCompactionResult, { status: 'failed' }> {
  return failure(
    'compaction_identity_conflict',
    `Compaction ${compactionId} already exists with different facts.`,
  );
}

function sessionNotFound(
  sessionId: string,
): Extract<BeginCompactionResult, { status: 'failed' }> {
  return failure('session_not_found', `Session ${sessionId} was not found.`);
}

function failure(
  code: string,
  message: string,
): { readonly status: 'failed'; readonly failure: SessionFailure } {
  return { status: 'failed', failure: { code, message } };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
