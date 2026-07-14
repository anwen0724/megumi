/*
 * Owns ephemeral Session branch draft lifecycle facts and emits branch draft events.
 */

import {
  createSessionBranchDraftCancelledEvent,
  createSessionBranchMarkerCreatedEvent,
} from '../../events';
import type { RuntimeContext, RuntimeEvent } from '../../events';
import type { SessionEntry } from '../domain/model/session-entry';

export type CreateSessionBranchDraftRequest = {
  request_id: string;
  session_id: string;
  source_message_id: string;
  runtime_context?: RuntimeContext;
};

export type SessionBranchDraft = {
  branch_marker_id: string;
  session_id: string;
  source_message_id: string;
  source_entry_id: string;
  created_at: string;
};

export type CreateSessionBranchDraftResult = {
  status: 'created';
  branch_draft: SessionBranchDraft;
  events: AsyncIterable<RuntimeEvent>;
};

export type CancelSessionBranchDraftRequest = {
  request_id: string;
  session_id: string;
  branch_marker_id: string;
  runtime_context?: RuntimeContext;
};

export type CancelSessionBranchDraftResult =
  | { status: 'cancelled'; events: AsyncIterable<RuntimeEvent> }
  | { status: 'not_cancelled'; reason: 'branch_marker_not_found' | 'branch_marker_not_active' };

export type ConsumeSessionBranchDraftRequest = { session_id: string; branch_marker_id: string };
export type ConsumeSessionBranchDraftResult =
  | { status: 'consumed'; branch_draft: SessionBranchDraft }
  | { status: 'not_consumed'; reason: 'branch_marker_not_found' | 'branch_marker_not_active' };

export interface SessionBranchService {
  createBranchDraft(request: CreateSessionBranchDraftRequest): CreateSessionBranchDraftResult;
  cancelBranchDraft(request: CancelSessionBranchDraftRequest): CancelSessionBranchDraftResult;
  consumeBranchDraft(request: ConsumeSessionBranchDraftRequest): ConsumeSessionBranchDraftResult;
}

interface SessionBranchServiceOptions {
  ids?: {
    branchMarkerId?: () => string;
    eventId?: () => string;
  };
  clock?: {
    now(): string;
  };
  entries?: {
    findMessageEntry(input: { session_id: string; message_id: string }): SessionEntry | undefined;
  };
}

type DraftState = SessionBranchDraft;

export function createSessionBranchService(
  options: SessionBranchServiceOptions = {},
): SessionBranchService {
  const drafts = new Map<string, DraftState>();
  const branchMarkerId = options.ids?.branchMarkerId ?? (() => `branch:${crypto.randomUUID()}`);
  const eventId = options.ids?.eventId ?? (() => `event:${crypto.randomUUID()}`);
  const now = options.clock?.now ?? (() => new Date().toISOString());

  return {
    createBranchDraft(request: CreateSessionBranchDraftRequest): CreateSessionBranchDraftResult {
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

      const event = createSessionBranchMarkerCreatedEvent({
        eventId: eventId(),
        sessionId: request.session_id,
        requestId: request.request_id,
        ...(request.runtime_context ? { context: request.runtime_context } : {}),
        sequence: 1,
        createdAt,
        payload: {
          branchMarkerId: markerId,
          branchMarkerSourceEntryId: branchDraft.source_entry_id,
          targetLeafSourceEntryId: branchDraft.source_entry_id,
          selectedSourceRef: { sourceId: request.source_message_id, sourceKind: 'message' },
          reason: 'branch',
        },
      });

      return {
        status: 'created',
        branch_draft: branchDraft,
        events: asyncEvents([event]),
      };
    },

    cancelBranchDraft(request: CancelSessionBranchDraftRequest): CancelSessionBranchDraftResult {
      const draft = drafts.get(request.branch_marker_id);
      if (!draft) {
        return { status: 'not_cancelled', reason: 'branch_marker_not_found' };
      }
      if (draft.session_id !== request.session_id) {
        return { status: 'not_cancelled', reason: 'branch_marker_not_active' };
      }

      drafts.delete(request.branch_marker_id);
      const event = createSessionBranchDraftCancelledEvent({
        eventId: eventId(),
        sessionId: request.session_id,
        requestId: request.request_id,
        ...(request.runtime_context ? { context: request.runtime_context } : {}),
        sequence: 1,
        createdAt: now(),
        payload: {
          branchMarkerId: request.branch_marker_id,
          branchMarkerSourceEntryId: draft.source_entry_id,
          restoredLeafSourceEntryId: draft.source_entry_id,
          reason: 'branch_cancelled',
        },
      });

      return { status: 'cancelled', events: asyncEvents([event]) };
    },

    consumeBranchDraft(request: ConsumeSessionBranchDraftRequest): ConsumeSessionBranchDraftResult {
      const draft = drafts.get(request.branch_marker_id);
      if (!draft) {
        return { status: 'not_consumed', reason: 'branch_marker_not_found' };
      }
      if (draft.session_id !== request.session_id) {
        return { status: 'not_consumed', reason: 'branch_marker_not_active' };
      }

      drafts.delete(request.branch_marker_id);
      return { status: 'consumed', branch_draft: draft };
    },
  };
}

function resolveSourceEntryId(
  options: SessionBranchServiceOptions,
  request: CreateSessionBranchDraftRequest,
): string {
  return options.entries?.findMessageEntry({
    session_id: request.session_id,
    message_id: request.source_message_id,
  })?.entry_id ?? `message:${request.source_message_id}`;
}

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}
