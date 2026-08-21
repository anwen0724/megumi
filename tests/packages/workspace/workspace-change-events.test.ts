import { describe, expect, it, vi } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import { createWorkspaceChangeEventHandler } from '@megumi/workspace';

describe('Workspace Change Runtime Events', () => {
  it('finalizes a ChangeSet from a terminal Run event', () => {
    const finalizeChangeSet = vi.fn(() => ({ status: 'not_found' as const }));
    const resolveWorkspaceId = vi.fn(() => 'workspace:1');
    const handle = createWorkspaceChangeEventHandler({ finalizeChangeSet }, resolveWorkspaceId);

    handle(eventFixture('turn.ended'));
    expect(finalizeChangeSet).not.toHaveBeenCalled();

    handle(eventFixture('run.ended'));
    expect(finalizeChangeSet).toHaveBeenCalledWith({
      workspace_id: 'workspace:1',
      session_id: 'session:1',
      execution_id: 'run:1',
      finalized_at: '2026-07-10T00:00:01.000Z',
    });
    expect(resolveWorkspaceId).toHaveBeenCalledWith('run:1');
  });

  it('does not finalize when the workspace cannot be resolved', () => {
    const finalizeChangeSet = vi.fn(() => ({ status: 'not_found' as const }));
    const handle = createWorkspaceChangeEventHandler({ finalizeChangeSet }, () => undefined);

    handle(eventFixture('run.ended'));
    expect(finalizeChangeSet).not.toHaveBeenCalled();
  });
});

function eventFixture(eventType: 'run.ended' | 'turn.ended'): AnyEvent {
  return {
    id: `event:${eventType}`,
    type: eventType,
    payload: eventType === 'run.ended' ? { status: 'completed' } : { messageId: 'message:1' },
    executionId: 'run:1',
    sessionId: 'session:1',
    sequence: 1,
    createdAt: '2026-07-10T00:00:01.000Z',
  } as AnyEvent;
}
