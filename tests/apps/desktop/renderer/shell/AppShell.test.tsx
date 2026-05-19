// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '@megumi/desktop/renderer/shell/AppShell';
import { ThemeProvider } from '@megumi/desktop/renderer/shared/theme';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact/store';
import { useMemoryStore } from '@megumi/desktop/renderer/entities/memory/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import type { TimelineMessageData } from '@megumi/desktop/renderer/entities/chat/types';

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

function installMegumiMock() {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      provider: {
        list: vi.fn().mockResolvedValue({ ok: true, providers: [] }),
        update: vi.fn().mockResolvedValue({ ok: true }),
        setApiKey: vi.fn().mockResolvedValue({ ok: true }),
        deleteApiKey: vi.fn().mockResolvedValue({ ok: true }),
      },
      session: {
        message: {
          send: vi.fn().mockResolvedValue({ ok: true }),
          cancel: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true }, meta: {} }),
        },
      },
      runtime: {
        onEvent: vi.fn(() => () => undefined),
      },
    },
  });
}

function createMessage(overrides: Partial<TimelineMessageData> = {}): TimelineMessageData {
  return {
    id: 'message-1',
    role: 'assistant',
    content: 'Hello from Megumi',
    stepNum: 1,
    timestamp: '2026-05-10T12:00:00.000Z',
    ...overrides,
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
          description: 'Warm agent desktop companion',
          repoPath: 'C:/all/work/study/megumi',
          type: 'existing_feature',
          createdAt: '2026-05-10T00:00:00.000Z',
          context: {},
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
    expect(screen.getByRole('button', { name: 'megumi sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review notes/ })).toBeInTheDocument();
    expect(screen.queryByText('Assistant activity')).not.toBeInTheDocument();
    expect(screen.getByText('Today, where should we start?')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Context' })).toBeVisible();
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

  it('uses existing project flow instead of creating a local session when no project is selected', async () => {
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
      loading: false,
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      activeAgentType: 'free',
    });
    const useExistingProject = vi.spyOn(useProjectStore.getState(), 'useExistingProject');

    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(useExistingProject).toHaveBeenCalled();
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  it('selects an existing session from the sidebar', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: /Review notes/ }));

    expect(useSessionStore.getState().activeSessionId).toBe('session-2');
  });

  it('switches current project when selecting a session from another project', async () => {
    const now = '2026-05-10T12:00:00.000Z';
    const projectB = {
      id: 'project-b',
      name: 'other',
      description: 'Another project',
      repoPath: null,
      type: 'existing_feature' as const,
      createdAt: now,
      context: {},
    };
    const sessionB = {
      id: 'session-b',
      projectId: 'project-b',
      agentType: 'free' as const,
      title: 'Other session',
      createdAt: now,
      updatedAt: now,
    };
    const openProject = vi.spyOn(useProjectStore.getState(), 'openProject').mockResolvedValue(projectB);
    useProjectStore.setState({
      projects: [
        {
          id: 'project-1',
          name: 'Megumi',
          description: 'Warm agent desktop companion',
          repoPath: 'C:/all/work/study/megumi',
          type: 'existing_feature',
          createdAt: now,
          context: {},
        },
        projectB,
      ],
      currentProjectId: 'project-1',
      loading: false,
    });
    useSessionStore.setState({
      sessions: [sessionB],
      activeSessionId: null,
      activeAgentType: 'free',
    });

    renderShell();

    await userEvent.click(screen.getByRole('button', { name: /Open session/ }));

    expect(useSessionStore.getState().activeSessionId).toBe(sessionB.id);
    expect(openProject).toHaveBeenCalledWith(sessionB.projectId);
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
    useChatStore.getState().setMessages([
      createMessage({
        id: 'session-1-user',
        role: 'user',
        content: 'Message from the first session',
        stepNum: 1,
      }),
    ]);

    renderShell();

    expect(screen.getByText('Message from the first session')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    expect(screen.queryByText('Message from the first session')).not.toBeInTheDocument();
    expect(screen.getByText('Today, where should we start?')).toBeInTheDocument();
    expect(useChatStore.getState().sessionSnapshots['session-1'].messages[0].content).toBe(
      'Message from the first session',
    );
  });

  it('restores the previous session timeline when selecting it again', async () => {
    useChatStore.getState().setMessages([
      createMessage({
        id: 'session-1-user',
        role: 'user',
        content: 'Saved in planning session',
        stepNum: 1,
      }),
    ]);

    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'New session' }));

    const createdSession = useSessionStore.getState().sessions[0];
    expect(createdSession.title).toBe('New session');
    expect(screen.queryByText('Saved in planning session')).not.toBeInTheDocument();

    useChatStore.getState().setMessages([
      createMessage({
        id: 'session-new-user',
        role: 'user',
        content: 'Message in new session',
        stepNum: 1,
      }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: /Planning the UI/ }));

    expect(screen.getByText('Saved in planning session')).toBeInTheDocument();
    expect(screen.queryByText('Message in new session')).not.toBeInTheDocument();
    expect(useChatStore.getState().sessionSnapshots[createdSession.id].messages[0].content).toBe(
      'Message in new session',
    );
  });

  it('collapses and expands the right workspace panel', async () => {
    renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse workspace panel' }));
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Expand workspace panel' }));
    expect(screen.getByRole('tab', { name: 'Context' })).toBeInTheDocument();
  });
});
