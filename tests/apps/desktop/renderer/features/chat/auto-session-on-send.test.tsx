// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { Project } from '@megumi/desktop/renderer/entities/project/types';
import type { LocalRendererSession } from '@megumi/desktop/renderer/entities/session/session-factory';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { ChatTimeline } from '@megumi/desktop/renderer/features/chat';

const project: Project = {
  id: 'project-1',
  name: 'Megumi',
  description: 'Warm agent desktop companion',
  repoPath: 'C:/all/work/study/megumi',
  type: 'existing_feature',
  createdAt: '2026-05-10T00:00:00.000Z',
  context: {},
};

function resetStores() {
  useProjectStore.setState({
    projects: [project],
    currentProjectId: project.id,
    loading: false,
  });

  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    activeAgentType: 'free',
  });

  useChatStore.setState({
    messages: [],
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    completedToolActivities: [],
    sessionSnapshots: {},
    agentStatus: 'idle',
    lastError: null,
  });

  useRunStore.getState().resetRuns();
}

function submitPrompt(prompt: string) {
  fireEvent.change(screen.getByLabelText('Message Megumi'), {
    target: { value: prompt },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

function installMegumiMock() {
  const session = {
    message: {
      send: vi.fn().mockImplementation((request) => Promise.resolve({
        ok: true,
        data: { requestId: request.requestId },
        meta: {
          requestId: request.requestId,
          channel: IPC_CHANNELS.session.message.send,
          handledAt: '2026-05-10T12:00:00.100Z',
        },
      })),
      cancel: vi.fn().mockResolvedValue({
        ok: true,
        data: { cancelled: true },
        meta: {
          requestId: 'ipc-session-message-cancel-1',
          channel: IPC_CHANNELS.session.message.cancel,
          handledAt: '2026-05-10T12:00:00.100Z',
        },
      }),
    },
  };

  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      session: {
        message: {
          send: session.message.send,
          cancel: session.message.cancel,
        },
      },
      runtime: {
        onEvent: vi.fn(() => () => undefined),
      },
      provider: {
        list: vi.fn(),
        update: vi.fn(),
        setApiKey: vi.fn(),
        deleteApiKey: vi.fn(),
      },
    },
  });

  return session;
}

describe('auto session on first send', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
    installMegumiMock();
    resetStores();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('creates and selects a local session from the first submitted message', () => {
    render(<ChatTimeline />);

    submitPrompt('  first line\nsecond line  ');

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(state.sessions[0].id);
    expect(state.sessions[0]).toMatchObject({
      projectId: 'project-1',
      title: 'first line second line',
      agentType: 'free',
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:00.000Z',
    });
  });

  it('uses local-workspace when no project is selected', () => {
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      loading: false,
    });

    render(<ChatTimeline />);

    submitPrompt('Start without a project');

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].projectId).toBe('local-workspace');
    expect(state.sessions[0].title).toBe('Start without a project');
    expect(state.activeSessionId).toBe(state.sessions[0].id);
  });

  it('does not create a duplicate session when one is already active', () => {
    const existingSession: LocalRendererSession = {
      id: 'session-existing',
      projectId: 'project-1',
      agentType: 'reviewer',
      title: 'Existing session',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    };

    useSessionStore.setState({
      sessions: [existingSession],
      activeSessionId: existingSession.id,
      activeAgentType: 'reviewer',
    });

    render(<ChatTimeline />);

    submitPrompt('Continue in the active session');

    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([existingSession]);
    expect(state.activeSessionId).toBe(existingSession.id);
  });

  it('renames a manually-created empty New session from its first message', () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-new',
          projectId: 'project-1',
          agentType: 'free',
          title: 'New session',
          createdAt: '2026-05-10T12:00:00.000Z',
          updatedAt: '2026-05-10T12:00:00.000Z',
        },
      ],
      activeSessionId: 'session-new',
      activeAgentType: 'free',
    });

    render(<ChatTimeline />);

    submitPrompt('Rename this session from prompt');

    expect(useSessionStore.getState().sessions[0].title).toBe('Rename this session from...');
  });

  it('does not rename an existing titled session on send', () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-existing',
          projectId: 'project-1',
          agentType: 'free',
          title: 'Planning the UI',
          createdAt: '2026-05-10T12:00:00.000Z',
          updatedAt: '2026-05-10T12:00:00.000Z',
        },
      ],
      activeSessionId: 'session-existing',
      activeAgentType: 'free',
    });

    render(<ChatTimeline />);

    submitPrompt('This should not rename the session');

    expect(useSessionStore.getState().sessions[0].title).toBe('Planning the UI');
  });
});
