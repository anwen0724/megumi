/* Owns ephemeral branch-draft references exposed to hosts during composition. */
import { createSessionBranchDraftCancelledEvent, createSessionBranchMarkerCreatedEvent } from '../../coding-agent/events';
import type { SessionBranchHostPort } from './chat-host';

export function createSessionBranchHost(): SessionBranchHostPort {
  const drafts = new Map<string, { sessionId: string; messageId: string; createdAt: string; intent: 'branch' | 'rerun' }>();

  return {
    createBranchDraft(input) {
      const branchMarkerId = `branch:${crypto.randomUUID()}`;
      drafts.set(branchMarkerId, {
        sessionId: input.sessionId,
        messageId: input.messageId,
        createdAt: input.createdAt,
        intent: input.intent,
      });
      const event = createSessionBranchMarkerCreatedEvent({
        eventId: `event:${crypto.randomUUID()}`,
        sessionId: input.sessionId,
        requestId: input.requestId,
        context: input.runtimeContext,
        sequence: 1,
        createdAt: input.createdAt,
        payload: {
          branchMarkerId,
          branchMarkerSourceEntryId: input.messageId,
          targetLeafSourceEntryId: input.messageId,
          selectedSourceRef: { sourceId: input.messageId, sourceKind: 'message' },
          reason: input.intent,
        },
      });
      return {
        payload: {
          branchDraft: {
            branchMarkerId,
            sessionId: input.sessionId,
            sourceMessageId: input.messageId,
            intent: input.intent,
            createdAt: input.createdAt,
          },
        },
        events: asyncEvents([event]),
      };
    },

    cancelBranchDraft(input) {
      const draft = drafts.get(input.branchMarkerId);
      if (!draft) return { payload: { cancelled: false, reason: 'branch_marker_not_found' } };
      if (draft.sessionId !== input.sessionId) {
        return { payload: { cancelled: false, reason: 'branch_marker_not_active' } };
      }
      drafts.delete(input.branchMarkerId);
      const event = createSessionBranchDraftCancelledEvent({
        eventId: `event:${crypto.randomUUID()}`,
        sessionId: input.sessionId,
        requestId: input.requestId,
        context: input.runtimeContext,
        sequence: 1,
        createdAt: input.createdAt,
        payload: {
          branchMarkerId: input.branchMarkerId,
          branchMarkerSourceEntryId: draft.messageId,
          restoredLeafSourceEntryId: draft.messageId,
          reason: 'branch_cancelled',
        },
      });
      return { payload: { cancelled: true }, events: asyncEvents([event]) };
    },
  };
}

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}
