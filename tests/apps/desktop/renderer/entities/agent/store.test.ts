// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStore } from '@megumi/desktop/renderer/entities/agent/store';

describe('useAgentStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00.000Z'));
    useAgentStore.setState({
      sessions: [],
      activeSessionId: null,
      activeAgentType: 'free',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds and selects a local session', () => {
    const session = useAgentStore.getState().createLocalSession({
      projectId: 'project-1',
      title: 'Planning the UI',
    });

    expect(session.title).toBe('Planning the UI');
    expect(session.projectId).toBe('project-1');
    expect(session.agentType).toBe('free');
    expect(session.createdAt).toBe('2026-05-09T12:00:00.000Z');
    expect(useAgentStore.getState().sessions).toEqual([session]);
    expect(useAgentStore.getState().activeSessionId).toBe(session.id);
  });

  it('creates local sessions at the top of the list', () => {
    const first = useAgentStore.getState().createLocalSession({
      projectId: 'project-1',
      title: 'First',
    });
    const second = useAgentStore.getState().createLocalSession({
      projectId: 'project-1',
      title: 'Second',
      agentType: 'reviewer',
    });

    expect(useAgentStore.getState().sessions.map((session) => session.id)).toEqual([second.id, first.id]);
    expect(useAgentStore.getState().activeSessionId).toBe(second.id);
    expect(second.agentType).toBe('reviewer');
  });

  it('selects an existing session', () => {
    const session = useAgentStore.getState().createLocalSession({
      projectId: 'project-1',
      title: 'Planning',
    });

    useAgentStore.getState().setActiveSession(null);
    useAgentStore.getState().setActiveSession(session.id);

    expect(useAgentStore.getState().activeSessionId).toBe(session.id);
  });
});
