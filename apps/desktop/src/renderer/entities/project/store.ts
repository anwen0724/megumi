import { create } from 'zustand';
import type { Project } from './types';

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  loading: boolean;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string | null) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, data: Partial<Project>) => void;
  removeProject: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProjectId: null,
  loading: false,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  addProject: (project) => set((s) => ({ projects: [project, ...s.projects] })),
  updateProject: (id, data) => set((s) => ({
    projects: s.projects.map((p) => (p.id === id ? { ...p, ...data } : p)),
  })),
  removeProject: (id) => set((s) => ({
    projects: s.projects.filter((p) => p.id !== id),
    currentProjectId: s.currentProjectId === id ? null : s.currentProjectId,
  })),
}));
