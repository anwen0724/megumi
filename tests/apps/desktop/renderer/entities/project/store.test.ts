import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import type { Project } from '@megumi/desktop/renderer/entities/project/types';

const mockProject: Project = {
  id: 'p1', name: 'Test', description: 'desc', repoPath: null,
  type: 'new_project', createdAt: '2026-01-01', context: {},
};

describe('useProjectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({ projects: [], currentProjectId: null, loading: false });
  });

  it('should set projects', () => {
    useProjectStore.getState().setProjects([mockProject]);
    expect(useProjectStore.getState().projects).toHaveLength(1);
  });

  it('should set current project', () => {
    useProjectStore.getState().setCurrentProject('p1');
    expect(useProjectStore.getState().currentProjectId).toBe('p1');
  });

  it('should add project to beginning', () => {
    const p2 = { ...mockProject, id: 'p2', name: 'Second' };
    useProjectStore.getState().addProject(mockProject);
    useProjectStore.getState().addProject(p2);
    expect(useProjectStore.getState().projects[0].id).toBe('p2');
  });

  it('should update project', () => {
    useProjectStore.getState().addProject(mockProject);
    useProjectStore.getState().updateProject('p1', { name: 'Updated' });
    expect(useProjectStore.getState().projects[0].name).toBe('Updated');
  });

  it('should remove project and clear currentProjectId if active', () => {
    useProjectStore.getState().addProject(mockProject);
    useProjectStore.getState().setCurrentProject('p1');
    useProjectStore.getState().removeProject('p1');
    expect(useProjectStore.getState().projects).toHaveLength(0);
    expect(useProjectStore.getState().currentProjectId).toBeNull();
  });
});