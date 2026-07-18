import { describe, expect, it } from 'vitest';
import { createSessionBranchService } from '@megumi/agent/session';

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe('SessionBranchService', () => {
  it('creates explicit branch drafts from assistant messages with owner ids and owner time', async () => {
    const service = createSessionBranchService({
      ids: {
        branchMarkerId: () => 'branch:owner-1',
        eventId: () => 'event:owner-1',
      },
      clock: { now: () => '2026-07-10T00:00:00.000Z' },
    });

    const result = service.createBranchDraft({
      request_id: 'request:branch',
      session_id: 'session:1',
      source_message_id: 'assistant-message:1',
    });

    expect(result.branch_draft).toEqual({
      branch_marker_id: 'branch:owner-1',
      session_id: 'session:1',
      source_message_id: 'assistant-message:1',
      source_entry_id: 'message:assistant-message:1',
      created_at: '2026-07-10T00:00:00.000Z',
    });
    await expect(collect(result.events)).resolves.toMatchObject([{
      eventId: 'event:owner-1',
      eventType: 'session.branch_marker.created',
      sessionId: 'session:1',
      createdAt: '2026-07-10T00:00:00.000Z',
      payload: {
        branchMarkerId: 'branch:owner-1',
        branchMarkerSourceEntryId: 'message:assistant-message:1',
        targetLeafSourceEntryId: 'message:assistant-message:1',
        selectedSourceRef: { sourceId: 'assistant-message:1', sourceKind: 'message' },
        reason: 'branch',
      },
    }]);
  });

  it('cancels active branch drafts with owner time and structured reasons', async () => {
    const service = createSessionBranchService({
      ids: {
        branchMarkerId: () => 'branch:owner-1',
        eventId: () => 'event:cancel-1',
      },
      clock: { now: () => '2026-07-10T00:01:00.000Z' },
    });
    service.createBranchDraft({
      request_id: 'request:branch',
      session_id: 'session:1',
      source_message_id: 'assistant-message:1',
    });

    const cancelled = service.cancelBranchDraft({
      request_id: 'request:cancel',
      session_id: 'session:1',
      branch_marker_id: 'branch:owner-1',
    });

    expect(cancelled.status).toBe('cancelled');
    if (cancelled.status === 'cancelled') {
      await expect(collect(cancelled.events)).resolves.toMatchObject([{
        eventId: 'event:cancel-1',
        eventType: 'session.branch_draft.cancelled',
        sessionId: 'session:1',
        createdAt: '2026-07-10T00:01:00.000Z',
        payload: {
          branchMarkerId: 'branch:owner-1',
          branchMarkerSourceEntryId: 'message:assistant-message:1',
          restoredLeafSourceEntryId: 'message:assistant-message:1',
          reason: 'branch_cancelled',
        },
      }]);
    }
    expect(service.cancelBranchDraft({
      request_id: 'request:cancel-2',
      session_id: 'session:1',
      branch_marker_id: 'branch:owner-1',
    })).toEqual({
      status: 'not_cancelled',
      reason: 'branch_marker_not_found',
    });
  });

  it('consumes active branch drafts and exposes only the resolved source entry to internal callers', () => {
    const service = createSessionBranchService({
      ids: {
        branchMarkerId: () => 'branch:owner-1',
        eventId: () => 'event:owner-1',
      },
      clock: { now: () => '2026-07-10T00:00:00.000Z' },
    });
    service.createBranchDraft({
      request_id: 'request:branch',
      session_id: 'session:1',
      source_message_id: 'assistant-message:1',
    });

    expect(service.consumeBranchDraft({
      session_id: 'session:1',
      branch_marker_id: 'branch:owner-1',
    })).toEqual({
      status: 'consumed',
      branch_draft: {
        branch_marker_id: 'branch:owner-1',
        session_id: 'session:1',
        source_message_id: 'assistant-message:1',
        source_entry_id: 'message:assistant-message:1',
        created_at: '2026-07-10T00:00:00.000Z',
      },
    });
    expect(service.consumeBranchDraft({
      session_id: 'session:1',
      branch_marker_id: 'branch:owner-1',
    })).toEqual({
      status: 'not_consumed',
      reason: 'branch_marker_not_found',
    });
  });
});
