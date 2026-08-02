import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/events';
import { createWorkspaceChangeEventHandler } from '@megumi/workspace';

describe('Workspace Change Runtime Events', () => {
  it('finalizes a ChangeSet from a terminal Run event owned by Workspace', () => {
    const finalizeChangeSet = vi.fn(() => ({ status: 'not_found' as const }));
    const handle = createWorkspaceChangeEventHandler({ finalizeChangeSet });

    handle(eventFixture('run.waiting'));
    expect(finalizeChangeSet).not.toHaveBeenCalled();

    handle(eventFixture('run.completed'));
    expect(finalizeChangeSet).toHaveBeenCalledWith({
      workspace_id: 'workspace:1',
      session_id: 'session:1',
      run_id: 'run:1',
      finalized_at: '2026-07-10T00:00:01.000Z',
    });
  });
});

function eventFixture(eventType: RuntimeEvent['eventType']): RuntimeEvent {
  return {
    eventId: `event:${eventType}`,
    schemaVersion: 1,
    eventType,
    runId: 'run:1',
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    sequence: 1,
    createdAt: '2026-07-10T00:00:01.000Z',
    source: 'core',
    visibility: 'system',
    persist: 'transient',
    payload: {},
  } as RuntimeEvent;
}
