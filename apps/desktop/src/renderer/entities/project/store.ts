import { create } from 'zustand';
import type { ProjectRecord } from '@megumi/shared/project-contracts';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';
import { projectFromRecord, type Project } from './types';
import { useSessionStore } from '../../entities/session/store';

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  loading: boolean;
  error: string | null;
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
  const rest = projects.filter((item) => item.id !== project.id);
  return [project, ...rest].sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
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
      createRendererRuntimeIpcRequest(IPC_CHANNELS.project.list, {}),
    );

    if (!result.ok) {
      set({ loading: false, error: getRuntimeIpcErrorMessage(result) });
      return;
    }

    set({
      projects: result.data.projects.map(projectFromRecord),
      loading: false,
      error: null,
    });
  },
  useExistingProject: async () => {
    set({ loading: true, error: null });
    const result = await window.megumi.project.useExisting(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.project.useExisting, {}),
    );

    if (!result.ok) {
      set({ loading: false, error: getRuntimeIpcErrorMessage(result) });
      return null;
    }

    if (result.data.cancelled) {
      set({ loading: false, error: null });
      return null;
    }

    const project = projectFromRecord(result.data.project);
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
      createRendererRuntimeIpcRequest(IPC_CHANNELS.project.open, { projectId }),
    );

    if (!result.ok) {
      set({ loading: false, error: getRuntimeIpcErrorMessage(result) });
      return null;
    }

    const project = projectFromRecord(result.data.project);
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
      createRendererRuntimeIpcRequest(IPC_CHANNELS.project.remove, { projectId }),
    );

    if (!result.ok) {
      set({ loading: false, error: getRuntimeIpcErrorMessage(result) });
      return false;
    }

    set((state) => {
      const isCurrentProject = state.currentProjectId === projectId;

      if (isCurrentProject) {
        const sessionState = useSessionStore.getState();
        sessionState.setActiveSession(null);
        sessionState.setSessions(
          sessionState.sessions.filter((session) => session.projectId !== projectId),
        );
      }

      return {
        projects: state.projects.filter((project) => project.id !== projectId),
        currentProjectId: isCurrentProject ? null : state.currentProjectId,
        loading: false,
        error: null,
      };
    });
    return result.data.removed;
  },
}));
