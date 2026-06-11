import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../entities/project/store';
import { useSessionStore } from '../entities/session/store';
import { useWorkspaceFilesStore } from '../entities/workspace-files';
import { useSessionHistoryHydration } from '../features/session-history/use-session-history-hydration';
import type { SidebarProjectItem } from './LeftSidebar';
import { formatSessionUpdatedAt } from './shell-display';

export function useAppBodyController() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);
  const { hydrateSessions, hydrateSessionTimeline } = useSessionHistoryHydration();

  const currentProject = projects.find((project) => project.id === currentProjectId) ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const pageTitle = settingsOpen ? 'Settings' : activeSession?.title ?? 'New session';

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

  const handleCreateSession = useCallback(() => {
    if (!currentProject) {
      setSettingsOpen(false);
      void useProjectStore.getState().useExistingProject();
      return;
    }

    setSettingsOpen(false);
    setActiveSession(null);
  }, [currentProject, setActiveSession]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId) {
      setSettingsOpen(false);
      return;
    }

    const selectedSession = sessions.find((session) => session.id === sessionId);
    if (!selectedSession) {
      return;
    }

    if (selectedSession.projectId !== currentProjectId) {
      useProjectStore.getState().setCurrentProject(selectedSession.projectId);
    }
    setSettingsOpen(false);
    setActiveSession(sessionId);
    await hydrateSessionTimeline(sessionId);
  }, [activeSessionId, currentProjectId, hydrateSessionTimeline, sessions, setActiveSession]);

  const handleUseExistingProject = useCallback(() => {
    void useProjectStore.getState().useExistingProject();
  }, []);

  const handleOpenProject = useCallback((projectId: string) => {
    void useProjectStore.getState().openProject(projectId);
  }, []);

  const handleRemoveProject = useCallback((projectId: string) => {
    void (async () => {
      const wasCurrent = projectId === useProjectStore.getState().currentProjectId;
      const removed = await useProjectStore.getState().removeProject(projectId);

      if (removed && wasCurrent) {
        setActiveSession(null);
        useWorkspaceFilesStore.getState().reset();
      }
    })();
  }, [setActiveSession]);

  const openSettings = useCallback(() => {
    setRightSidebarOpen(false);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const toggleWorkspaceSidebar = useCallback(() => {
    setRightSidebarOpen((value) => !value);
  }, []);

  return {
    sidebarCollapsed,
    rightSidebarOpen,
    settingsOpen,
    pageTitle,
    projects,
    sidebarProjects,
    setSidebarCollapsed,
    setRightSidebarOpen,
    setActiveSession,
    handleCreateSession,
    handleSelectSession,
    handleUseExistingProject,
    handleOpenProject,
    handleRemoveProject,
    openSettings,
    closeSettings,
    toggleRightSidebar: toggleWorkspaceSidebar,
  };
}
