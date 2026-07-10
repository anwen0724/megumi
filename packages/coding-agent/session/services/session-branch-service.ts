/*
 * Owns ephemeral Session branch draft lifecycle facts and emits branch draft events.
 */

import {
  createSessionBranchDraftCancelledEvent,
  createSessionBranchMarkerCreatedEvent,
} from '../../events';
import type {
  CancelSessionBranchDraftRequest,
  CancelSessionBranchDraftResult,
  CreateSessionBranchDraftRequest,
  CreateSessionBranchDraftResult,
  SessionBranchDraft,
  SessionBranchService,
} from '../contracts/session-branch-contracts';

interface SessionBranchServiceOptions {
  ids?: {
    branchMarkerId?: () => string;
    eventId?: () => string;
  };
  clock?: {
    now(): string;
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
          branchMarkerSourceEntryId: request.source_message_id,
          targetLeafSourceEntryId: request.source_message_id,
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
          branchMarkerSourceEntryId: draft.source_message_id,
          restoredLeafSourceEntryId: draft.source_message_id,
          reason: 'branch_cancelled',
        },
      });

      return { status: 'cancelled', events: asyncEvents([event]) };
    },
  };
}

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}
