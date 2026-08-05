/* Owns in-process Session branch draft lifecycle and branch facts on the bus. */
import type { EventBus } from '@megumi/events';
import type { SessionEntry } from './session-entry-graph';

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
  /** The event bus; branch facts are published here (session-scoped, no runId). */
  events: EventBus;
  ids?: {
    branchMarkerId?: () => string;
  };
  clock?: { now(): string };
  entries?: {
    findMessageEntry(input: { session_id: string; message_id: string }): SessionEntry | undefined;
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
  return options.entries?.findMessageEntry({
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
