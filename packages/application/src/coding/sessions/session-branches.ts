/* Owns session entry paths and pending branch selections. */
import type { EventBus } from '../events/event-bus';
import type { SessionMessageAttachment } from './session-attachments';
import type { Session, SessionFailure } from './session-catalog';
import { sessionFailure } from './session-catalog';
import type { SessionMessage } from './session-history';
import type { SessionStore } from './session-storage';

export interface CreateSessionBranchDraftRequest {
  request_id: string;
  session_id: string;
  source_message_id: string;
}

export interface SessionBranchDraft {
  branch_marker_id: string;
  session_id: string;
  source_message_id: string;
  source_entry_id: string;
  created_at: string;
}

export interface CreateSessionBranchDraftResult {
  status: 'created';
  branch_draft: SessionBranchDraft;
}

export interface CancelSessionBranchDraftRequest {
  request_id: string;
  session_id: string;
  branch_marker_id: string;
}

export type CancelSessionBranchDraftResult =
  | { status: 'cancelled' }
  | { status: 'not_cancelled'; reason: 'branch_marker_not_found' | 'branch_marker_not_active' };

export interface ResolveSessionBranchDraftRequest {
  request_id: string;
  session_id: string;
  branch_marker_id: string;
}

export type ResolveSessionBranchDraftResult =
  | { status: 'resolved'; branch_draft: SessionBranchDraft }
  | {
      status: 'not_resolved';
      reason: 'branch_marker_not_found' | 'branch_marker_not_active' | 'branch_marker_already_committed';
    };

export type CommitSessionBranchDraftRequest = ResolveSessionBranchDraftRequest;

export type CommitSessionBranchDraftResult =
  | { status: 'committed' | 'already_committed'; branch_draft: SessionBranchDraft }
  | {
      status: 'not_committed';
      reason: 'branch_marker_not_found' | 'branch_marker_not_active' | 'branch_marker_already_committed';
    };

export interface SessionBranchDrafts {
  createBranchDraft(request: CreateSessionBranchDraftRequest): CreateSessionBranchDraftResult;
  cancelBranchDraft(request: CancelSessionBranchDraftRequest): CancelSessionBranchDraftResult;
  resolveBranchDraft(request: ResolveSessionBranchDraftRequest): ResolveSessionBranchDraftResult;
  commitBranchDraft(request: CommitSessionBranchDraftRequest): CommitSessionBranchDraftResult;
}

export interface CreateSessionBranchDraftsOptions {
  /** The event bus; branch facts are published here (session-scoped, no executionId). */
  events: EventBus;
  ids?: {
    branchMarkerId?: () => string;
  };
  clock?: { now(): string };
  entries?: {
    findMessageEntryBySessionIdAndMessageId(input: {
      session_id: string;
      message_id: string;
    }): SessionEntry | undefined;
  };
}

interface CommittedDraftState {
  branch_draft: SessionBranchDraft;
  request_id: string;
}

const MAX_COMMITTED_DRAFTS = 256;

export function createSessionBranchDrafts(
  options: CreateSessionBranchDraftsOptions,
): SessionBranchDrafts {
  const drafts = new Map<string, SessionBranchDraft>();
  const committedDrafts = new Map<string, CommittedDraftState>();
  const branchMarkerId = options.ids?.branchMarkerId ?? (() => `branch:${crypto.randomUUID()}`);
  const now = options.clock?.now ?? (() => new Date().toISOString());

  return {
    createBranchDraft(request) {
      const createdAt = now();
      const markerId = branchMarkerId();
      const branchDraft: SessionBranchDraft = {
        branch_marker_id: markerId,
        session_id: request.session_id,
        source_message_id: request.source_message_id,
        source_entry_id: resolveSourceEntryId(options, request),
        created_at: createdAt,
      };
      drafts.set(markerId, branchDraft);
      options.events.publish({
        type: 'session.branch_marker.created',
        payload: { markerId },
        sessionId: request.session_id,
      });
      return {
        status: 'created',
        branch_draft: branchDraft,
      };
    },
    cancelBranchDraft(request) {
      const draft = drafts.get(request.branch_marker_id);
      if (!draft) return { status: 'not_cancelled', reason: 'branch_marker_not_found' };
      if (draft.session_id !== request.session_id) {
        return { status: 'not_cancelled', reason: 'branch_marker_not_active' };
      }
      drafts.delete(request.branch_marker_id);
      options.events.publish({
        type: 'session.branch_draft.cancelled',
        payload: { draftId: request.branch_marker_id },
        sessionId: request.session_id,
      });
      return { status: 'cancelled' };
    },
    resolveBranchDraft(request) {
      const draft = drafts.get(request.branch_marker_id);
      if (draft) {
        return draft.session_id === request.session_id
          ? { status: 'resolved', branch_draft: draft }
          : { status: 'not_resolved', reason: 'branch_marker_not_active' };
      }
      const committed = committedDrafts.get(request.branch_marker_id);
      if (!committed) return { status: 'not_resolved', reason: 'branch_marker_not_found' };
      if (committed.branch_draft.session_id !== request.session_id) {
        return { status: 'not_resolved', reason: 'branch_marker_not_active' };
      }
      if (committed.request_id !== request.request_id) {
        return { status: 'not_resolved', reason: 'branch_marker_already_committed' };
      }
      return { status: 'resolved', branch_draft: committed.branch_draft };
    },
    commitBranchDraft(request) {
      const draft = drafts.get(request.branch_marker_id);
      if (!draft) {
        const committed = committedDrafts.get(request.branch_marker_id);
        if (!committed) return { status: 'not_committed', reason: 'branch_marker_not_found' };
        if (committed.branch_draft.session_id !== request.session_id) {
          return { status: 'not_committed', reason: 'branch_marker_not_active' };
        }
        if (committed.request_id !== request.request_id) {
          return { status: 'not_committed', reason: 'branch_marker_already_committed' };
        }
        return { status: 'already_committed', branch_draft: committed.branch_draft };
      }
      if (draft.session_id !== request.session_id) {
        return { status: 'not_committed', reason: 'branch_marker_not_active' };
      }
      drafts.delete(request.branch_marker_id);
      committedDrafts.set(request.branch_marker_id, {
        branch_draft: draft,
        request_id: request.request_id,
      });
      pruneCommittedDrafts(committedDrafts);
      return { status: 'committed', branch_draft: draft };
    },
  };
}

function resolveSourceEntryId(
  options: CreateSessionBranchDraftsOptions,
  request: CreateSessionBranchDraftRequest,
): string {
  return options.entries?.findMessageEntryBySessionIdAndMessageId({
    session_id: request.session_id,
    message_id: request.source_message_id,
  })?.entry_id ?? `message:${request.source_message_id}`;
}

function pruneCommittedDrafts(committedDrafts: Map<string, CommittedDraftState>): void {
  while (committedDrafts.size > MAX_COMMITTED_DRAFTS) {
    const oldestMarkerId = committedDrafts.keys().next().value;
    if (!oldestMarkerId) return;
    committedDrafts.delete(oldestMarkerId);
  }
}

export interface SessionEntry {
  entry_id: string;
  session_id: string;
  parent_entry_id?: string;
  entry_type: 'message' | 'compaction';
  message_id?: string;
  compaction_id?: string;
  created_at: string;
}

export interface SessionCompactionSummary {
  compaction_id: string;
  session_id: string;
  summary_text: string;
  covered_until_entry_id: string;
  first_kept_entry_id?: string;
  /** AI Usage of the Summary ModelCall, when the Summary was generated by the model. */
  usage?: unknown;
  created_at: string;
}

export type SessionHistoryItem =
  | {
      type: 'message';
      entry: SessionEntry;
      message: SessionMessage;
      attachments: SessionMessageAttachment[];
    }
  | {
      type: 'compaction';
      entry: SessionEntry;
      compaction: SessionCompactionSummary;
    };

export interface GetActivePathRequest {
  session_id: string;
}

export type GetActivePathResult =
  | { status: 'ok'; entries: SessionEntry[] }
  | { status: 'failed'; failure: SessionFailure };

export type AppendSessionEntryRequest = SessionEntry;

export type AppendSessionEntryResult =
  | { status: 'appended'; entry: SessionEntry }
  | { status: 'failed'; failure: SessionFailure };

export interface SwitchActiveEntryRequest {
  session_id: string;
  active_entry_id?: string;
  updated_at: string;
}

export type SwitchActiveEntryResult =
  | { status: 'updated'; session: Session }
  | { status: 'failed'; failure: SessionFailure };

export interface SessionEntryGraph {
  getActivePath(request: GetActivePathRequest): GetActivePathResult;
  appendSessionEntry(request: AppendSessionEntryRequest): AppendSessionEntryResult;
  switchActiveEntry(request: SwitchActiveEntryRequest): SwitchActiveEntryResult;
}

export function createSessionEntryGraph(input: { store: SessionStore }): SessionEntryGraph {
  return {
    getActivePath(request) {
      try {
        return readActivePath(input.store, request.session_id);
      } catch (error) {
        return sessionFailure(error);
      }
    },
    appendSessionEntry(request) {
      try {
        const validation = validateSessionEntry(request);
        if (validation.status === 'failed') {
          return {
            status: 'failed',
            failure: { code: 'invalid_session_entry', message: validation.message },
          };
        }
        if (request.parent_entry_id) {
          const parent = input.store.findEntryById(request.parent_entry_id);
          if (!parent || parent.session_id !== request.session_id) {
            return {
              status: 'failed',
              failure: {
                code: 'invalid_parent_entry',
                message: 'parent_entry_id must belong to the same session',
              },
            };
          }
        }
        return { status: 'appended', entry: input.store.insertEntry(request) };
      } catch (error) {
        return sessionFailure(error);
      }
    },
    switchActiveEntry(request) {
      try {
        if (request.active_entry_id) {
          const entry = input.store.findEntryById(request.active_entry_id);
          if (!entry || entry.session_id !== request.session_id) {
            return {
              status: 'failed',
              failure: {
                code: 'invalid_active_entry',
                message: 'active_entry_id must belong to the session',
              },
            };
          }
        }
        const session = input.store.updateSessionActiveEntry(request);
        return session
          ? { status: 'updated', session }
          : {
              status: 'failed',
              failure: {
                code: 'session_not_found',
                message: `Session ${request.session_id} was not found`,
              },
            };
      } catch (error) {
        return sessionFailure(error);
      }
    },
  };
}

export function readActivePath(
  store: SessionStore,
  sessionId: string,
  throughEntryId?: string | null,
): GetActivePathResult {
  const session = store.findSessionById(sessionId);
  if (!session) {
    return {
      status: 'failed',
      failure: { code: 'session_not_found', message: `Session ${sessionId} was not found` },
    };
  }
  if (throughEntryId === null) return { status: 'ok', entries: [] };
  if (throughEntryId !== undefined) {
    const throughEntry = store.findEntryById(throughEntryId);
    if (!throughEntry || throughEntry.session_id !== sessionId) {
      return {
        status: 'failed',
        failure: {
          code: 'invalid_through_entry',
          message: 'through_entry_id must belong to the session',
        },
      };
    }
  }
  return {
    status: 'ok',
    entries: buildActivePath({
      session_id: sessionId,
      active_entry_id: throughEntryId ?? session.active_entry_id,
      entries: store.listEntriesBySessionId(sessionId),
    }),
  };
}

export function buildActivePath(input: {
  session_id: string;
  active_entry_id?: string;
  entries: SessionEntry[];
}): SessionEntry[] {
  if (!input.active_entry_id) return [];

  const entriesById = new Map(input.entries.map((entry) => [entry.entry_id, entry]));
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = input.active_entry_id;
  while (currentId) {
    if (seen.has(currentId)) {
      throw new Error(`Cycle detected in session active path for ${input.session_id}: ${currentId}`);
    }
    seen.add(currentId);
    const entry = entriesById.get(currentId);
    if (!entry) {
      throw new Error(`Active path parent entry ${currentId} was not found in session ${input.session_id}`);
    }
    if (entry.session_id !== input.session_id) {
      throw new Error(`Active path entry ${entry.entry_id} does not belong to session ${input.session_id}`);
    }
    path.unshift(entry);
    currentId = entry.parent_entry_id;
  }
  return path;
}

export function buildActiveConversationPath(input: {
  session_id: string;
  active_entry_id?: string;
  entries: SessionEntry[];
  compactions: SessionCompactionSummary[];
}): SessionEntry[] {
  if (!input.active_entry_id) return [];

  const entriesById = new Map(input.entries.map((entry) => [entry.entry_id, entry]));
  const compactionsById = new Map(input.compactions.map((item) => [item.compaction_id, item]));
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = input.active_entry_id;
  while (currentId) {
    if (seen.has(currentId)) {
      throw new Error(`Cycle detected in session conversation path for ${input.session_id}: ${currentId}`);
    }
    seen.add(currentId);
    const entry = entriesById.get(currentId);
    if (!entry) {
      throw new Error(`Conversation path entry ${currentId} was not found in session ${input.session_id}`);
    }
    if (entry.session_id !== input.session_id) {
      throw new Error(`Conversation path entry ${entry.entry_id} does not belong to session ${input.session_id}`);
    }
    if (entry.entry_type === 'compaction') {
      const compaction = entry.compaction_id ? compactionsById.get(entry.compaction_id) : undefined;
      if (!compaction) {
        throw new Error(`Compaction ${entry.compaction_id ?? 'unknown'} was not found in session ${input.session_id}`);
      }
      currentId = compaction.covered_until_entry_id;
      continue;
    }
    path.unshift(entry);
    currentId = entry.parent_entry_id;
  }
  return path;
}

export function validateSessionEntry(
  entry: SessionEntry,
): { status: 'ok' } | { status: 'failed'; message: string } {
  if (entry.entry_type === 'message') {
    return entry.message_id && !entry.compaction_id
      ? { status: 'ok' }
      : {
          status: 'failed',
          message: 'message entry must have message_id and must not have compaction_id',
        };
  }
  return entry.compaction_id && !entry.message_id
    ? { status: 'ok' }
    : {
        status: 'failed',
        message: 'compaction entry must have compaction_id and must not have message_id',
      };
}
