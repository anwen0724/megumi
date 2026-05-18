import { useMemo, useState } from 'react';
import { useSessionStore } from '../entities/session/store';
import { useChatStore } from '../entities/chat/store';
import { useProjectStore } from '../entities/project/store';
import { ChatTimeline } from '../features/chat';
import { LeftSidebar, type SidebarSessionItem } from './LeftSidebar';
import { RightWorkspacePanel } from './RightWorkspacePanel';
import { SettingsModal } from './SettingsModal';
import { WindowTitleBar } from './WindowTitleBar';
import { formatSessionUpdatedAt, getWorkspaceBasename } from './shell-display';

const LOCAL_WORKSPACE_ID = 'local-workspace';

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const createLocalSession = useSessionStore((state) => state.createLocalSession);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);

  const currentProject = projects.find((project) => project.id === currentProjectId) ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const workspaceBasename = getWorkspaceBasename({
    workspaceName: currentProject?.name,
    workspacePath: currentProject?.repoPath,
  });
  const titlebarTitle = activeSession?.title ?? 'New session';

  const sidebarSessions = useMemo<SidebarSessionItem[]>(
    () =>
      sessions.map((session) => ({
        id: session.id,
        title: session.title,
        meta: formatSessionUpdatedAt(session.updatedAt),
        active: session.id === activeSessionId,
      })),
    [activeSessionId, sessions],
  );

  function saveActiveChatSnapshot() {
    if (!activeSessionId) {
      return;
    }

    useChatStore.getState().saveCurrentSessionSnapshot(activeSessionId);
  }

  function handleCreateSession() {
    saveActiveChatSnapshot();

    const session = createLocalSession({
      projectId: currentProject?.id ?? LOCAL_WORKSPACE_ID,
      title: 'New session',
      agentType: 'free',
    });

    useChatStore.getState().loadSessionSnapshot(session.id);
  }

  function handleSelectSession(sessionId: string) {
    if (sessionId === activeSessionId) {
      return;
    }

    saveActiveChatSnapshot();
    setActiveSession(sessionId);
    useChatStore.getState().loadSessionSnapshot(sessionId);
  }

  return (
    <div className="flex h-screen min-h-0 bg-[var(--color-app-bg)] text-[var(--color-text)]">
      <LeftSidebar
        collapsed={sidebarCollapsed}
        workspaceName={workspaceBasename}
        sessions={sidebarSessions}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onCreateSession={handleCreateSession}
        onSelectSession={handleSelectSession}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <WindowTitleBar title={titlebarTitle} />
        <div className="flex min-h-0 flex-1">
          <ChatTimeline />
          <RightWorkspacePanel
            collapsed={rightPanelCollapsed}
            onToggleCollapsed={() => setRightPanelCollapsed((value) => !value)}
          />
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
