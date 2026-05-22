import { useEffect, useMemo, useState } from 'react';
import { useSessionStore } from '../entities/session/store';
import { useChatStore } from '../entities/chat/store';
import { useProjectStore } from '../entities/project/store';
import { useWorkspaceFilesStore } from '../entities/workspace-files';
import { ChatTimeline } from '../features/chat';
import { useSessionHistoryHydration } from '../features/session-history/use-session-history-hydration';
import { LeftSidebar, type SidebarProjectItem } from './LeftSidebar';
import { RightWorkspacePanel } from './RightWorkspacePanel';
import { SettingsModal } from './SettingsModal';
import { WindowTitleBar } from './WindowTitleBar';
import { formatSessionUpdatedAt } from './shell-display';

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
  const { hydrateSessions, hydrateSessionTimeline } = useSessionHistoryHydration();

  const currentProject = projects.find((project) => project.id === currentProjectId) ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const titlebarTitle = activeSession?.title ?? 'New session';

  useEffect(() => {
    void (async () => {
      await useProjectStore.getState().loadProjects();
      await hydrateSessions();
    })();
  }, [hydrateSessions]);

  const sidebarProjects = useMemo<SidebarProjectItem[]>(
    () => {
      const sorted = [...projects].sort(
        (a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime(),
      );
      const limited = sorted.slice(0, 8);
      return limited.map((project) => ({
        id: project.id,
        name: project.name,
        repoPath: project.repoPath,
        status: project.status,
        sessions: sessions
          .filter((session) => session.projectId === project.id)
          .map((session) => ({
            id: session.id,
            title: session.title,
            meta: formatSessionUpdatedAt(session.updatedAt),
            active: session.id === activeSessionId,
          })),
      }));
    },
    [projects, sessions, activeSessionId],
  );

  function saveActiveChatSnapshot() {
    if (!activeSessionId) {
      return;
    }

    useChatStore.getState().saveCurrentSessionSnapshot(activeSessionId);
  }

  function handleCreateSession() {
    saveActiveChatSnapshot();

    if (!currentProject) {
      void useProjectStore.getState().useExistingProject();
      return;
    }

    const session = createLocalSession({
      projectId: currentProject.id,
      title: 'New session',
      agentType: 'free',
    });

    useChatStore.getState().loadSessionSnapshot(session.id);
  }

  async function handleSelectSession(sessionId: string) {
    if (sessionId === activeSessionId) {
      return;
    }

    const selectedSession = sessions.find((session) => session.id === sessionId);
    if (!selectedSession) {
      return;
    }

    saveActiveChatSnapshot();
    if (selectedSession.projectId !== currentProjectId) {
      await useProjectStore.getState().openProject(selectedSession.projectId);
    }
    setActiveSession(sessionId);
    await hydrateSessionTimeline(sessionId);
  }

  return (
    <div className="flex h-screen min-h-0 bg-[var(--color-app-bg)] text-[var(--color-text)]">
      <LeftSidebar
        collapsed={sidebarCollapsed}
        projects={sidebarProjects}
        allProjects={projects}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onCreateSession={handleCreateSession}
        onSelectSession={(sessionId) => {
          void handleSelectSession(sessionId);
        }}
        onUseExistingProject={() => {
          void useProjectStore.getState().useExistingProject();
        }}
        onManageProjects={() => {
          // LeftSidebar manages the modal open state internally
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProject={(projectId) => {
          void useProjectStore.getState().openProject(projectId);
        }}
        onRemoveProject={(projectId) => {
          void (async () => {
            const wasCurrent = projectId === useProjectStore.getState().currentProjectId;
            const removed = await useProjectStore.getState().removeProject(projectId);

            if (removed && wasCurrent) {
              setActiveSession(null);
              useWorkspaceFilesStore.getState().reset();
            }
          })();
        }}
      />
      <div className="flex min-w-[62rem] flex-1 flex-col overflow-hidden">
        <WindowTitleBar title={titlebarTitle} />
        <div data-testid="workbench-content" className="flex min-h-0 min-w-[62rem] flex-1 overflow-hidden">
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
