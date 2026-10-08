import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => useSessionStore.setState({
    sessions: [], activeSessionId: null, newSessionDraftTargetProjectId: null,
  }));

  it('requests asynchronous memory work once when entering a persisted session', async () => {
    const startGeneration = vi.fn().mockResolvedValue({ ok: true, data: { status: 'skipped', reason: 'disabled' } });
    vi.stubGlobal('window', { megumi: { memory: { startGeneration } } });
    useSessionStore.getState().upsertSession(session);
    useSessionStore.getState().setActiveSession(session.id);
    useSessionStore.getState().setActiveSession(session.id);
    await Promise.resolve();
    expect(startGeneration).toHaveBeenCalledTimes(1);
    expect(startGeneration.mock.calls[0][0].payload).toMatchObject({ reason: 'startup', triggerSessionId: session.id });
  });

  it('stores and replaces canonical Product Host Session projections', () => {
    useSessionStore.getState().upsertSession(session);
    useSessionStore.getState().upsertSession({ ...session, title: 'Updated by Product' });
    expect(useSessionStore.getState().sessions).toEqual([{ ...session, title: 'Updated by Product' }]);
  });

  it('represents a new session only as a UI draft target and clears it without creating a Session', () => {
    useSessionStore.getState().startNewSessionDraft('workspace:1');
    expect(useSessionStore.getState()).toMatchObject({
      sessions: [], activeSessionId: null, newSessionDraftTargetProjectId: 'workspace:1',
    });

    useSessionStore.getState().clearNewSessionDraft();
    expect(useSessionStore.getState()).toMatchObject({
      sessions: [], activeSessionId: null, newSessionDraftTargetProjectId: null,
    });
  });
});
