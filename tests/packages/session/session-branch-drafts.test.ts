import { describe, expect, it } from 'vitest';
import { createEventBus, type AnyEvent } from '../../../packages/agent/events/src/index';
import { createSessionBranchDrafts } from '../../../packages/agent/session/src/index';

describe('SessionBranchDrafts', () => {
  it('creates explicit branch drafts and publishes the branch fact on the bus', () => {
    const events = createEventBus();
    const published: AnyEvent[] = [];
    events.subscribe({}, (event) => { published.push(event); });

    const service = createSessionBranchDrafts({
      events,
      ids: { branchMarkerId: () => 'branch:owner-1' },
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
    expect(published).toEqual([
      expect.objectContaining({
        type: 'session.branch_marker.created',
        sessionId: 'session:1',
        payload: { markerId: 'branch:owner-1' },
      }),
    ]);
    expect(published[0]).not.toHaveProperty('executionId');
  });

  it('cancels active branch drafts with owner time and publishes the cancellation fact', () => {
    const events = createEventBus();
    const published: AnyEvent[] = [];
    events.subscribe({}, (event) => { published.push(event); });

    const service = createSessionBranchDrafts({
      events,
      ids: { branchMarkerId: () => 'branch:owner-1' },
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
    expect(published.at(-1)).toEqual(expect.objectContaining({
      type: 'session.branch_draft.cancelled',
      sessionId: 'session:1',
      payload: { draftId: 'branch:owner-1' },
    }));
    expect(published.at(-1)).not.toHaveProperty('executionId');
    expect(service.cancelBranchDraft({
      request_id: 'request:cancel-2',
      session_id: 'session:1',
      branch_marker_id: 'branch:owner-1',
    })).toEqual({
      status: 'not_cancelled',
      reason: 'branch_marker_not_found',
    });
  });

  it('resolves without consuming, commits only after start, and supports the same request retry', () => {
    const service = createSessionBranchDrafts({
      events: createEventBus(),
      ids: { branchMarkerId: () => 'branch:owner-1' },
      clock: { now: () => '2026-07-10T00:00:00.000Z' },
    });
    service.createBranchDraft({
      request_id: 'request:branch',
      session_id: 'session:1',
      source_message_id: 'assistant-message:1',
    });

    expect(service.resolveBranchDraft({
      request_id: 'request:run',
      session_id: 'session:1',
      branch_marker_id: 'branch:owner-1',
    })).toEqual({
      status: 'resolved',
      branch_draft: {
        branch_marker_id: 'branch:owner-1',
        session_id: 'session:1',
        source_message_id: 'assistant-message:1',
        source_entry_id: 'message:assistant-message:1',
        created_at: '2026-07-10T00:00:00.000Z',
      },
    });
  });
});
