import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import { createRendererRuntimeIpcRequest, getRendererRuntimeIpcError } from '../../shared/ipc';
import {
  rendererError,
  type RendererErrorDescriptor,
} from '../../shared/i18n';
import { projectFromRecord, type Project, type ProjectRecord } from './types';
import { useSessionStore } from '../../entities/session/store';

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  loading: boolean;
  error: RendererErrorDescriptor | null;
  getInitialState: () => Pick<ProjectState, 'projects' | 'currentProjectId' | 'loading' | 'error'>;
  mapProjectRecord: (record: ProjectRecord) => Project;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string | null) => void;
  loadProjects: () => Promise<void>;
  useExistingProject: () => Promise<Project | null>;
  openProject: (projectId: string) => Promise<Project | null>;
  removeProject: (projectId: string) => Promise<boolean>;
}

const initialState = {
  projects: [],
  currentProjectId: null,
  loading: false,
  error: null,
};

function upsertProject(projects: Project[], project: Project): Project[] {
  const existingProject = projects.find((item) => item.id === project.id);
  if (existingProject) {
    return projects;
  }

  return [...projects, project];
}

function getMostRecentlyOpenedProjectId(projects: Project[]): string | null {
  return projects.reduce<Project | null>((mostRecent, project) => {
    if (!mostRecent || project.lastOpenedAt.localeCompare(mostRecent.lastOpenedAt) > 0) {
      return project;
    }

    return mostRecent;
  }, null)?.id ?? null;
}

function clearActiveSessionOutsideProject(projectId: string): void {
  const sessionState = useSessionStore.getState();
  const activeSessionId = sessionState.activeSessionId;
  if (!activeSessionId) {
    return;
  }

  const activeSession = sessionState.sessions.find((session) => session.id === activeSessionId);
  if (!activeSession || activeSession.projectId !== projectId) {
    sessionState.setActiveSession(null);
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  ...initialState,
  getInitialState: () => initialState,
  mapProjectRecord: projectFromRecord,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  loadProjects: async () => {
    set({ loading: true, error: null });
    const result = await window.megumi.project.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.projectList, {}),
    );

    if (!result.ok) {
      set({ loading: false, error: getRendererRuntimeIpcError(result, 'project_load_failed') });
      return;
    }

    const projects = result.data.projects.map(projectFromRecord);
    const currentProjectStillExists = projects.some((project) => project.id === get().currentProjectId);

    set({
      projects,
      currentProjectId: currentProjectStillExists
        ? get().currentProjectId
        : getMostRecentlyOpenedProjectId(projects),
      loading: false,
      error: null,
    });
  },
  useExistingProject: async () => {
    set({ loading: true, error: null });
    const result = await window.megumi.project.useExisting(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.projectUseExisting, {}),
    );

    if (!result.ok) {
      set({ loading: false, error: getRendererRuntimeIpcError(result, 'project_use_failed') });
      return null;
    }

    if (result.data.status === 'failed') {
      set({ loading: false, error: rendererError(result.data.failure.code, result.data.failure.message, undefined, 'project_use_failed') });
      return null;
    }

    if (result.data.status === 'cancelled') {
      set({ loading: false, error: null });
      return null;
    }

    const project = projectFromRecord(result.data.project);
    clearActiveSessionOutsideProject(project.id);
    useSessionStore.getState().setNewSessionDraftTargetProject(null);
    set((state) => ({
      projects: upsertProject(state.projects, project),
      currentProjectId: project.id,
      loading: false,
      error: null,
    }));
    return project;
  },
  openProject: async (projectId) => {
    set({ loading: true, error: null });
    const result = await window.megumi.project.open(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.projectOpen, { projectId }),
    );

    if (!result.ok) {
      set({ loading: false, error: getRendererRuntimeIpcError(result, 'project_open_failed') });
      return null;
    }

    if (result.data.status === 'not_found') {
      set({ loading: false, error: rendererError('project_not_found') });
      return null;
    }

    if (result.data.status === 'failed') {
      set({ loading: false, error: rendererError(result.data.failure.code, result.data.failure.message, undefined, 'project_open_failed') });
      return null;
    }

    const project = projectFromRecord(result.data.project);
    clearActiveSessionOutsideProject(project.id);
    useSessionStore.getState().setNewSessionDraftTargetProject(null);
    set((state) => ({
      projects: upsertProject(state.projects, project),
      currentProjectId: project.id,
      loading: false,
      error: null,
    }));
    return project;
  },
  removeProject: async (projectId) => {
    set({ loading: true, error: null });
    const result = await window.megumi.project.remove(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.projectRemove, { projectId }),
    );

    if (!result.ok) {
      set({ loading: false, error: getRendererRuntimeIpcError(result, 'project_remove_failed') });
      return false;
    }

    if (result.data.status === 'blocked') {
      set({ loading: false, error: rendererError('project_remove_blocked') });
      return false;
    }

    if (result.data.status === 'failed') {
      set({ loading: false, error: rendererError(result.data.failure.code, result.data.failure.message, undefined, 'project_remove_failed') });
      return false;
    }

    set((state) => {
      const isCurrentProject = state.currentProjectId === projectId;

      if (isCurrentProject) {
        const sessionState = useSessionStore.getState();
        sessionState.setActiveSession(null);
      }

      return {
        projects: state.projects.filter((project) => project.id !== projectId),
        currentProjectId: isCurrentProject ? null : state.currentProjectId,
        loading: false,
        error: null,
      };
    });
    return result.data.status === 'removed';
  },
}));
