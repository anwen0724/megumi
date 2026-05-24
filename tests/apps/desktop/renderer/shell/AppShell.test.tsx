// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '@megumi/desktop/renderer/shell/AppShell';
import { ThemeProvider } from '@megumi/desktop/renderer/shared/theme';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact/store';
import { useMemoryStore } from '@megumi/desktop/renderer/entities/memory/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useChatStreamStore } from '@megumi/desktop/renderer/features/chat-stream';

const { minimize, toggleMaximize, close } = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@megumi/desktop/renderer/shared/ipc/client', () => ({
  windowControls: {
    minimize,
    toggleMaximize,
    close,
  },
}));

const DEFAULT_PROJECT_RECORD = {
  projectId: 'project-1',
  name: 'Megumi',
  repoPath: 'C:/all/work/study/megumi',
  repoPathKey: 'c:/all/work/study/megumi',
  status: 'available' as const,
  createdAt: '2026-05-10T00:00:00.000Z',
  lastOpenedAt: '2026-05-19T00:00:00.000Z',
};

function installMegumiMock() {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      project: {
        list: vi.fn().mockResolvedValue({ ok: true, data: { projects: [DEFAULT_PROJECT_RECORD] } }),
        useExisting: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true } }),
        open: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            project: DEFAULT_PROJECT_RECORD,
          },
        }),
        remove: vi.fn().mockResolvedValue({ ok: true, data: { projectId: 'project-1', removed: true } }),
      },
      provider: {
        list: vi.fn().mockResolvedValue({ ok: true, providers: [] }),
        update: vi.fn().mockResolvedValue({ ok: true }),
        setApiKey: vi.fn().mockResolvedValue({ ok: true }),
        deleteApiKey: vi.fn().mockResolvedValue({ ok: true }),
      },
      session: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            sessions: [
              {
                sessionId: 'session-1',
                workspaceId: 'project-1',
                workspacePath: 'C:/all/work/study/megumi',
                title: 'Planning the UI',
                status: 'active',
                createdAt: '2026-05-10T00:00:00.000Z',
                updatedAt: '2026-05-10T00:00:00.000Z',
              },
              {
                sessionId: 'session-2',
                workspaceId: 'project-1',
                workspacePath: 'C:/all/work/study/megumi',
                title: 'Review notes',
                status: 'active',
                createdAt: '2026-05-10T00:10:00.000Z',
                updatedAt: '2026-05-10T00:10:00.000Z',
              },
            ],
          },
        }),
        message: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { messages: [] } }),
          send: vi.fn().mockResolvedValue({ ok: true }),
          cancel: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true }, meta: {} }),
        },
        timeline: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { messages: [], diagnostics: [] } }),
        },
      },
      runtime: {
        onEvent: vi.fn(() => () => undefined),
      },
      run: {
        listBySession: vi.fn().mockResolvedValue({ ok: true, data: { runs: [] } }),
        events: {
          list: vi.fn().mockResolvedValue({ ok: true, data: { events: [] } }),
        },
      },
    },
  });
}

function committedUser(messageId: string, sessionId: string, text: string) {
  return {
    messageId,
    projectId: 'project-1',
    sessionId,
    role: 'user' as const,
    createdAt: '2026-05-10T12:00:00.000Z',
    updatedAt: '2026-05-10T12:00:00.000Z',
    blocks: [{
      blockId: `user-text:${messageId}`,
      kind: 'user_text' as const,
      text,
      format: 'plain' as const,
    }],
  };
}

function renderShell() {
  return render(
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>,
  );
}

describe('AppShell', () => {
  beforeEach(() => {
    minimize.mockReset();
    toggleMaximize.mockReset();
    close.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
    installMegumiMock();

    useProjectStore.setState({
      projects: [
        {
          id: 'project-1',
          name: 'Megumi',
          repoPath: 'C:/all/work/study/megumi',
          createdAt: '2026-05-10T00:00:00.000Z',
          projectId: 'project-1',
          repoPathKey: 'c:/all/work/study/megumi',
          lastOpenedAt: '2026-05-19T00:00:00.000Z',
          status: 'available' as const,
        },
      ],
      currentProjectId: 'project-1',
      loading: false,
    });

    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          agentType: 'free',
          title: 'Planning the UI',
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
        {
          id: 'session-2',
          projectId: 'project-1',
          agentType: 'reviewer',
          title: 'Review notes',
          createdAt: '2026-05-10T00:10:00.000Z',
          updatedAt: '2026-05-10T00:10:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });

    useChatUiStore.setState({
      agentStatus: 'idle',
      lastError: null,
    });

    useRunStore.getState().resetRuns();
    useChatStreamStore.getState().reset();
    useArtifactStore.getState().clearArtifacts();
    useMemoryStore.setState({
      settings: undefined,
      candidates: [],
      memories: [],
      selectedMemory: undefined,
      selectedSourceRefs: [],
      accessLogs: [],
      recallPreview: undefined,
      loading: false,
      error: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the refined workspace shell with session title and compact sidebar sessions', () => {
    renderShell();
    const titlebar = screen.getByTestId('window-titlebar');
    const workbenchContent = screen.getByTestId('workbench-content');

    expect(titlebar).toBeInTheDocument();
    expect(workbenchContent).toHaveClass('min-w-[62rem]');
    expect(workbenchContent).toHaveClass('overflow-hidden');
    expect(within(titlebar).getByText('Planning the UI')).toBeInTheDocument();
    expect(within(titlebar).queryByText('C:/all/work/study/megumi')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Megumi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review notes/ })).toBeInTheDocument();
    expect(screen.queryByText('Assistant activity')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('chat-timeline-root')).getByText('C:/all/work/study/megumi')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Context' })).toBeVisible();
  });

  it('hydrates historical sessions without selecting one until the user restores it', async () => {
    installMegumiMock();
    window.megumi.session.list = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sessions: [
          {
            sessionId: 'session-history',
            title: 'Historical investigation',
            workspaceId: 'project-1',
            workspacePath: 'C:/all/work/study/megumi',
            status: 'active',
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:30:00.000Z',
          },
        ],
      },
    });
    window.megumi.session.timeline.list = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        messages: [
          {
            messageId: 'message-user-history',
            projectId: 'project-1',
            sessionId: 'session-history',
            role: 'user',
            createdAt: '2026-05-09T00:00:00.000Z',
            updatedAt: '2026-05-09T00:00:00.000Z',
            blocks: [{
              blockId: 'user-text:message-user-history',
              kind: 'user_text',
              text: 'What changed yesterday?',
              format: 'plain',
            }],
          },
          {
            messageId: 'assistant:run-history',
            projectId: 'project-1',
            sessionId: 'session-history',
            runId: 'run-history',
            role: 'assistant',
            createdAt: '2026-05-09T00:01:00.000Z',
            updatedAt: '2026-05-09T00:01:00.000Z',
            blocks: [{
              blockId: 'answer:run-history',
              kind: 'answer_text',
              runId: 'run-history',
              textId: 'text-history',
              status: 'completed',
              text: 'The timeline was updated.',
              format: 'markdown',
            }],
          },
        ],
        diagnostics: [],
      },
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      activeAgentType: 'free',
    });
    renderShell();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Historical investigation/ })).toBeInTheDocument();
    });
    expect(useSessionStore.getState().activeSessionId).toBeNull();
    expect(screen.queryByText('What changed yesterday?')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Historical investigation/ }));

    await waitFor(() => {
      expect(screen.getByText('What changed yesterday?')).toBeInTheDocument();
    });
    expect(screen.getByText('The timeline was updated.')).toBeInTheDocument();
    expect(useSessionStore.getState().activeSessionId).toBe('session-history');
    expect(window.megumi.session.timeline.list).toHaveBeenCalledWith(expect.objectContaining({
      payload: { projectId: 'project-1', sessionId: 'session-history' },
    }));
  });

  it('calls loadProjects on mount', () => {
    renderShell();

    expect(window.megumi.project.list).toHaveBeenCalled();
  });

  it('creates and selects a local session from the sidebar', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    const state = useSessionStore.getState();
    expect(state.sessions[0].title).toBe('New session');
    expect(state.sessions[0].projectId).toBe('project-1');
    expect(state.activeSessionId).toBe(state.sessions[0].id);
    expect(screen.getAllByText('New session')[0]).toBeInTheDocument();
  });

  it('uses existing project flow instead of creating a session when no project is selected', async () => {
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      loading: false,
    });
    vi.mocked(window.megumi.project.list).mockResolvedValueOnce({
      ok: true,
      data: { projects: [] },
      meta: {
        requestId: 'ipc-project-list-empty-test',
        channel: 'project:list',
        handledAt: '2026-05-10T12:00:00.000Z',
      },
    });
    const useExistingProject = vi
      .spyOn(useProjectStore.getState(), 'useExistingProject')
      .mockResolvedValue(null);

    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    const state = useSessionStore.getState();
    expect(useExistingProject).toHaveBeenCalled();
    expect(state.sessions).toHaveLength(2);
    expect(state.activeSessionId).toBe('session-1');
  });

  it('selects an existing session from the sidebar', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: /Review notes/ }));

    expect(useSessionStore.getState().activeSessionId).toBe('session-2');
  });

  it('opens the owning project when selecting a session from another project', async () => {
    const projectB = {
      id: 'project-2',
      name: 'Other',
      repoPath: 'C:/all/work/study/other',
      createdAt: '2026-05-10T00:00:00.000Z',
      projectId: 'project-2',
      repoPathKey: 'c:/all/work/study/other',
      lastOpenedAt: '2026-05-20T00:00:00.000Z',
      status: 'available' as const,
    };
    useProjectStore.setState({
      projects: [...useProjectStore.getState().projects, projectB],
      currentProjectId: 'project-1',
    });
    vi.mocked(window.megumi.project.list).mockResolvedValueOnce({
      ok: true,
      data: {
        projects: [DEFAULT_PROJECT_RECORD, {
          projectId: projectB.projectId,
          name: projectB.name,
          repoPath: projectB.repoPath,
          repoPathKey: projectB.repoPathKey,
          status: projectB.status,
          createdAt: projectB.createdAt,
          lastOpenedAt: projectB.lastOpenedAt,
        }],
      },
      meta: {
        requestId: 'ipc-project-list-test',
        channel: 'project:list',
        handledAt: '2026-05-10T12:00:00.000Z',
      },
    });
    useSessionStore.setState({
      sessions: [
        ...useSessionStore.getState().sessions,
        {
          id: 'session-3',
          projectId: 'project-2',
          agentType: 'free',
          title: 'Other project session',
          createdAt: '2026-05-10T00:20:00.000Z',
          updatedAt: '2026-05-10T00:20:00.000Z',
        },
      ],
    });
    const openProject = vi.spyOn(useProjectStore.getState(), 'openProject').mockResolvedValue(projectB);

    renderShell();

    await userEvent.click(screen.getByRole('button', { name: /Other project session/ }));

    await waitFor(() => expect(useSessionStore.getState().activeSessionId).toBe('session-3'));
    expect(openProject).toHaveBeenCalledWith('project-2');
  });

  it('collapses and expands the left sidebar while keeping new-session access in the rail', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByText('Review notes')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(useSessionStore.getState().sessions[0].title).toBe('New session');

    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getAllByText('New session')[0]).toBeInTheDocument();
  });

  it('opens and closes settings from the expanded sidebar', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('opens settings from the collapsed sidebar rail', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Settings' })).getAllByText('Local desktop preferences')).toHaveLength(2);
  });

  it('clears the center timeline when creating a new local session', async () => {
    useChatStreamStore.getState().hydrateCommittedMessages('project-1', 'session-1', [
      committedUser('session-1-user', 'session-1', 'Message from the first session'),
    ]);

    renderShell();

    expect(screen.getByText('Message from the first session')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(screen.queryByText('Message from the first session')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('chat-timeline-root')).getByText('C:/all/work/study/megumi')).toBeInTheDocument();
  });

  it('restores the previous session timeline when selecting it again', async () => {
    window.megumi.session.timeline.list = vi.fn().mockImplementation((request) => Promise.resolve({
      ok: true,
      data: {
        messages: request.payload.sessionId === 'session-1'
          ? [{
              messageId: 'message-session-1-user',
              projectId: 'project-1',
              sessionId: 'session-1',
              role: 'user',
              createdAt: '2026-05-10T12:00:00.000Z',
              updatedAt: '2026-05-10T12:00:00.000Z',
              blocks: [{
                blockId: 'user-text:message-session-1-user',
                kind: 'user_text',
                text: 'Saved in planning session',
                format: 'plain',
              }],
            }]
          : [],
        diagnostics: [],
      },
    }));

    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    const createdSession = useSessionStore.getState().sessions[0];
    expect(createdSession.title).toBe('New session');
    expect(screen.queryByText('Saved in planning session')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Planning the UI/ }));

    await waitFor(() => {
      expect(screen.getByText('Saved in planning session')).toBeInTheDocument();
    });
    expect(screen.queryByText('Message in new session')).not.toBeInTheDocument();
  });

  it('collapses and expands the right workspace panel', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse workspace panel' }));
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Expand workspace panel' }));
    expect(screen.getByRole('tab', { name: 'Context' })).toBeInTheDocument();
  });
});
