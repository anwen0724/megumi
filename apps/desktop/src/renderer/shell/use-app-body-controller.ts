/*
 * Owns top-level shell navigation, including externally requested Settings destinations.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../entities/project/store';
import { useSessionStore } from '../entities/session/store';
import { useWorkspaceFilesStore } from '../entities/workspace-files';
import type { SidebarProjectItem } from './LeftSidebar';
import { formatSessionUpdatedAt } from './shell-display';
import type { DiscoveryRecommendationUiDto } from '@megumi/product-host/host';
import { useApplicationUpdateStore } from '../features/application-update';
import type { SettingsCategory } from './SettingsPage';

export function useAppBodyController() {
  const [activePage, setActivePage] = useState<'discovery' | 'chat'>('discovery');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('appearance');
  const aboutRequestId = useApplicationUpdateStore((state) => state.aboutRequestId);
  const projects = useProjectStore((state) => state.projects);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);
  const startNewSessionDraft = useSessionStore((state) => state.startNewSessionDraft);
  const startRecommendationSessionDraft = useSessionStore((state) => state.startRecommendationSessionDraft);
  const clearNewSessionDraft = useSessionStore((state) => state.clearNewSessionDraft);

  const currentProject = projects.find((project) => project.id === currentProjectId) ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const pageTitle = settingsOpen
    ? 'Settings'
    : activePage === 'discovery'
      ? 'Today\'s discoveries'
      : activeSession?.title ?? 'New session';

  useEffect(() => {
    void (async () => {
      await useProjectStore.getState().loadProjects();
      await useSessionStore.getState().loadSessions();
    })();
  }, []);

  const sidebarProjects = useMemo<SidebarProjectItem[]>(
    () => {
      const limited = projects.slice(0, 8);
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
    setActivePage('chat');
    if (!currentProject) {
      setSettingsOpen(false);
      void useProjectStore.getState().useExistingProject();
      return;
    }

    setSettingsOpen(false);
    startNewSessionDraft(currentProject.id);
  }, [currentProject, startNewSessionDraft]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActivePage('chat');
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
  }, [activeSessionId, currentProjectId, sessions, setActiveSession]);

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

  const showSettingsCategory = useCallback((category: SettingsCategory) => {
    setRightSidebarOpen(false);
    setSettingsCategory(category);
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    if (aboutRequestId > 0) showSettingsCategory('about');
  }, [aboutRequestId, showSettingsCategory]);

  const openSettings = useCallback(() => {
    showSettingsCategory('appearance');
  }, [showSettingsCategory]);

  const openContentSources = useCallback(() => {
    showSettingsCategory('sources');
  }, [showSettingsCategory]);

  const openDiscovery = useCallback(() => {
    setRightSidebarOpen(false);
    setSettingsOpen(false);
    setActivePage('discovery');
    clearNewSessionDraft();
  }, [clearNewSessionDraft]);

  const handleStartRecommendationConversation = useCallback((recommendation: DiscoveryRecommendationUiDto) => {
    void (async () => {
      const project = currentProject ?? await useProjectStore.getState().useExistingProject();
      if (!project) return;
      setSettingsOpen(false);
      setActivePage('chat');
      startRecommendationSessionDraft(project.id, recommendation);
    })();
  }, [currentProject, startRecommendationSessionDraft]);

  useEffect(() => window.megumi.character.onOpenSettingsRequested?.(openSettings), [openSettings]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const toggleWorkspaceSidebar = useCallback(() => {
    setRightSidebarOpen((value) => !value);
  }, []);

  return {
    sidebarCollapsed,
    activePage,
    rightSidebarOpen,
    settingsOpen,
    settingsCategory,
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
    openContentSources,
    openDiscovery,
    handleStartRecommendationConversation,
    closeSettings,
    toggleRightSidebar: toggleWorkspaceSidebar,
  };
}
