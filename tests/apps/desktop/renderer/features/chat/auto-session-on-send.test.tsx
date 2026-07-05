// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { Project } from '@megumi/desktop/renderer/entities/project/types';
import type { LocalRendererSession } from '@megumi/desktop/renderer/entities/session/session-factory';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import {
  chatStreamSessionKey,
  useChatStreamStore,
} from '@megumi/desktop/renderer/features/chat-stream';
import { ChatPage } from '@megumi/desktop/renderer/features/chat';

const project: Project = {
  id: 'project-1',
  name: 'Megumi',
  repoPath: 'C:/all/work/study/megumi',
  createdAt: '2026-05-10T00:00:00.000Z',
  projectId: 'project-1',
  repoPathKey: 'c:/all/work/study/megumi',
  lastOpenedAt: '2026-05-19T00:00:00.000Z',
  status: 'available' as const,
};

const otherProject: Project = {
  id: 'project-2',
  name: 'Other',
  repoPath: 'C:/all/work/study/other',
  createdAt: '2026-05-10T00:00:00.000Z',
  projectId: 'project-2',
  repoPathKey: 'c:/all/work/study/other',
  lastOpenedAt: '2026-05-20T00:00:00.000Z',
  status: 'available' as const,
};

function resetStores() {
  useProviderStore.setState({
    providers: [{
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      enabled: true,
      modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      hasApiKey: true,
      credentialSource: 'settings',
      envOverrideActive: false,
    }],
    status: 'ready',
    error: null,
    loadProviders: vi.fn(),
  });

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

  useChatUiStore.setState({
    activeSessionId: null,
    agentStatus: 'idle',
    lastError: null,
    sessionStates: {},
  });

  useRunStore.getState().resetRuns();
  useChatStreamStore.getState().reset();
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
        data: {
          requestId: request.requestId,
          session: {
            sessionId: request.payload.sessionId ?? 'session-created-1',
            title: request.payload.context?.sessionTitle ?? 'first line second line',
            workspaceId: request.payload.context?.workspaceId,
            workspacePath: request.payload.context?.workspacePath,
            createdAt: '2026-05-10T12:00:00.000Z',
            updatedAt: '2026-05-10T12:00:00.000Z',
            status: 'active',
          },
          userMessageId: request.payload.message.id,
          runId: 'run-created-1',
        },
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
      chatStream: {
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

function expectCanonicalUserMessage(sessionId: string, text: string) {
  expect(useChatStreamStore.getState().sessions[
    chatStreamSessionKey('project-1', sessionId)
  ].messages).toEqual([
    expect.objectContaining({
      role: 'user',
      blocks: [expect.objectContaining({
        kind: 'user_text',
        text,
      })],
    }),
  ]);
}

function expectCanonicalUserMessageForProject(projectId: string, sessionId: string, text: string) {
  expect(useChatStreamStore.getState().sessions[
    chatStreamSessionKey(projectId, sessionId)
  ].messages).toEqual([
    expect.objectContaining({
      role: 'user',
      blocks: [expect.objectContaining({
        kind: 'user_text',
        text,
      })],
    }),
  ]);
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

  it('creates and selects a backend session from the first submitted message', async () => {
    render(<ChatPage />);

    submitPrompt('  first line\nsecond line  ');

    await vi.waitFor(() => {
      expect(window.megumi.session.message.send).toHaveBeenCalledTimes(1);
    });

    const request = vi.mocked(window.megumi.session.message.send).mock.calls[0][0];
    expect(request.payload).not.toHaveProperty('sessionId');
    expect(request.payload.context).toMatchObject({
      workspaceId: 'project-1',
      workspaceLabel: 'Megumi',
      workspacePath: 'C:/all/work/study/megumi',
      sessionTitle: 'first line second line',
    });

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      id: 'session-created-1',
      projectId: 'project-1',
      title: 'first line second line',
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:00.000Z',
    });
    expect(state.activeSessionId).toBe('session-created-1');
    expectCanonicalUserMessage(state.sessions[0].id, 'first line\nsecond line');
  });

  it('creates the first backend session in the draft target project and then makes it current', async () => {
    useProjectStore.setState({
      projects: [project, otherProject],
      currentProjectId: project.id,
      loading: false,
    });
    useSessionStore.getState().setNewSessionDraftTargetProject(otherProject.id);

    render(<ChatPage />);

    submitPrompt('Send this to the draft target');

    await vi.waitFor(() => {
      expect(window.megumi.session.message.send).toHaveBeenCalledTimes(1);
    });

    const request = vi.mocked(window.megumi.session.message.send).mock.calls[0][0];
    expect(request.payload).not.toHaveProperty('sessionId');
    expect(request.payload.context).toMatchObject({
      workspaceId: otherProject.id,
      workspaceLabel: otherProject.name,
      workspacePath: otherProject.repoPath,
      sessionTitle: 'Send this to the draft t...',
    });

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      id: 'session-created-1',
      projectId: 'project-2',
    });
    expect(state.activeSessionId).toBe('session-created-1');
    expect(state.newSessionDraftTargetProjectId).toBeNull();
    expect(useProjectStore.getState().currentProjectId).toBe(otherProject.id);
    expectCanonicalUserMessageForProject(otherProject.id, 'session-created-1', 'Send this to the draft target');
  });

  it('does not create or send a runtime session when no project is selected', () => {
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      loading: false,
    });

    render(<ChatPage />);

    submitPrompt('Start without a project');

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
    expect(window.megumi.session.message.send).not.toHaveBeenCalled();
    expect(useChatUiStore.getState().lastError).toBe('Select a project before sending a message.');
  });

  it('does not create a duplicate session when one is already active', async () => {
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

    render(<ChatPage />);

    submitPrompt('Continue in the active session');

    await vi.waitFor(() => {
      expect(window.megumi.session.message.send).toHaveBeenCalledTimes(1);
    });

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      id: existingSession.id,
      projectId: existingSession.projectId,
      title: existingSession.title,
      agentType: existingSession.agentType,
    });
    expect(state.activeSessionId).toBe(existingSession.id);
    expectCanonicalUserMessage(existingSession.id, 'Continue in the active session');
  });

  it('does not create a duplicate for an existing empty New session', async () => {
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

    render(<ChatPage />);

    submitPrompt('Rename this session from prompt');

    await vi.waitFor(() => {
      expect(window.megumi.session.message.send).toHaveBeenCalledTimes(1);
    });

    expect(useSessionStore.getState().sessions).toHaveLength(1);
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-new',
      title: 'New session',
    });
    expectCanonicalUserMessage('session-new', 'Rename this session from prompt');
  });

  it('does not rename an existing titled session on send', async () => {
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

    render(<ChatPage />);

    submitPrompt('This should not rename the session');

    await vi.waitFor(() => {
      expect(window.megumi.session.message.send).toHaveBeenCalledTimes(1);
    });

    expect(useSessionStore.getState().sessions[0].title).toBe('Planning the UI');
    expectCanonicalUserMessage('session-existing', 'This should not rename the session');
  });
});

