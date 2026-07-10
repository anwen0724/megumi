import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';

const session = {
  id: 'session:1',
  projectId: 'workspace:1',
  title: 'Product session',
  status: 'active' as const,
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('useSessionStore', () => {
  beforeEach(() => useSessionStore.setState({
    sessions: [], activeSessionId: null, newSessionDraftTargetProjectId: null,
  }));

  it('stores and replaces canonical Product Host Session projections', () => {
    useSessionStore.getState().upsertSession(session);
    useSessionStore.getState().upsertSession({ ...session, title: 'Updated by Product' });
    expect(useSessionStore.getState().sessions).toEqual([{ ...session, title: 'Updated by Product' }]);
  });

  it('represents a new session only as a UI draft target', () => {
    useSessionStore.getState().startNewSessionDraft('workspace:1');
    expect(useSessionStore.getState()).toMatchObject({
      sessions: [], activeSessionId: null, newSessionDraftTargetProjectId: 'workspace:1',
    });
  });
});
