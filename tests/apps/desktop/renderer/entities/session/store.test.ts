// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';

describe('useSessionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00.000Z'));
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      activeAgentType: 'free',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds and selects a local session', () => {
    const session = useSessionStore.getState().createLocalSession({
      projectId: 'project-1',
      title: 'Planning the UI',
    });

    expect(session.title).toBe('Planning the UI');
    expect(session.projectId).toBe('project-1');
    expect(session.agentType).toBe('free');
    expect(session.createdAt).toBe('2026-05-09T12:00:00.000Z');
    expect(useSessionStore.getState().sessions).toEqual([session]);
    expect(useSessionStore.getState().activeSessionId).toBe(session.id);
  });

  it('creates local sessions at the top of the list', () => {
    const first = useSessionStore.getState().createLocalSession({
      projectId: 'project-1',
      title: 'First',
    });
    const second = useSessionStore.getState().createLocalSession({
      projectId: 'project-1',
      title: 'Second',
      agentType: 'reviewer',
    });

    expect(useSessionStore.getState().sessions.map((session) => session.id)).toEqual([second.id, first.id]);
    expect(useSessionStore.getState().activeSessionId).toBe(second.id);
    expect(second.agentType).toBe('reviewer');
  });

  it('selects an existing session', () => {
    const session = useSessionStore.getState().createLocalSession({
      projectId: 'project-1',
      title: 'Planning',
    });

    useSessionStore.getState().setActiveSession(null);
    useSessionStore.getState().setActiveSession(session.id);

    expect(useSessionStore.getState().activeSessionId).toBe(session.id);
  });
});
