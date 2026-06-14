import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import type { Project } from '@megumi/desktop/renderer/entities/project/types';

const projectRecord = {
  projectId: 'project:abc123',
  name: 'megumi',
  repoPath: 'C:/all/work/study/megumi',
  repoPathKey: 'c:/all/work/study/megumi',
  status: 'available' as const,
  createdAt: '2026-05-19T00:00:00.000Z',
  lastOpenedAt: '2026-05-19T00:00:01.000Z',
};

function ok<T extends object, C extends string>(data: T, channel: C) {
  return {
    ok: true as const,
    data,
    meta: {
      requestId: 'ipc-project-test',
      channel,
      handledAt: '2026-05-19T00:00:01.000Z',
    },
  };
}

function fail<C extends string>(channel: C) {
  return {
    ok: false as const,
    error: {
      code: 'ipc_handler_failed' as const,
      message: 'Project service failed.',
      severity: 'error' as const,
      retryable: true,
      source: 'main' as const,
    },
    meta: {
      requestId: 'ipc-project-test',
      channel,
      handledAt: '2026-05-19T00:00:01.000Z',
    },
  };
}

beforeEach(() => {
  useProjectStore.setState(useProjectStore.getState().getInitialState());
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    activeAgentType: 'free',
  });
  window.megumi = {
    project: {
      list: vi.fn(async () => ok({ projects: [projectRecord] }, IPC_CHANNELS.project.list)),
      useExisting: vi.fn(async () => ok({ cancelled: false, project: projectRecord }, IPC_CHANNELS.project.useExisting)),
      open: vi.fn(async () => ok({ project: projectRecord }, IPC_CHANNELS.project.open)),
      remove: vi.fn(async () => ok({ projectId: projectRecord.projectId, removed: true }, IPC_CHANNELS.project.remove)),
    },
  } as unknown as typeof window.megumi;
});

describe('useProjectStore', () => {
  it('loads projects from main and maps shared records to renderer projects', async () => {
    await useProjectStore.getState().loadProjects();

    expect(window.megumi.project.list).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ channel: IPC_CHANNELS.project.list }),
    }));
    expect(useProjectStore.getState().projects).toEqual<Project[]>([
      {
        id: projectRecord.projectId,
        projectId: projectRecord.projectId,
        name: 'megumi',
        repoPath: projectRecord.repoPath,
        repoPathKey: projectRecord.repoPathKey,
        status: 'available',
        createdAt: projectRecord.createdAt,
        lastOpenedAt: projectRecord.lastOpenedAt,
      },
    ]);
  });

  it('restores the most recently opened project when loading projects with no current project', async () => {
    const olderProjectRecord = {
      ...projectRecord,
      projectId: 'project:older',
      name: 'older',
      repoPath: 'C:/all/work/study/older',
      repoPathKey: 'c:/all/work/study/older',
      lastOpenedAt: '2026-05-18T00:00:00.000Z',
    };
    vi.mocked(window.megumi.project.list).mockResolvedValueOnce(
      ok({ projects: [olderProjectRecord, projectRecord] }, IPC_CHANNELS.project.list),
    );

    await useProjectStore.getState().loadProjects();

    expect(useProjectStore.getState().currentProjectId).toBe(projectRecord.projectId);
  });

  it('uses an existing project and makes it current', async () => {
    const result = await useProjectStore.getState().useExistingProject();

    expect(result?.id).toBe(projectRecord.projectId);
    expect(useProjectStore.getState().currentProjectId).toBe(projectRecord.projectId);
  });

  it('keeps state unchanged when directory selection is cancelled', async () => {
    vi.mocked(window.megumi.project.useExisting).mockResolvedValueOnce(
      ok({ cancelled: true }, IPC_CHANNELS.project.useExisting),
    );

    await expect(useProjectStore.getState().useExistingProject()).resolves.toBeNull();
    expect(useProjectStore.getState().projects).toEqual([]);
    expect(useProjectStore.getState().currentProjectId).toBeNull();
  });

  it('opens an existing project and makes it current', async () => {
    useProjectStore.setState({
      projects: [useProjectStore.getState().mapProjectRecord(projectRecord)],
    });

    await useProjectStore.getState().openProject(projectRecord.projectId);

    expect(window.megumi.project.open).toHaveBeenCalledWith(expect.objectContaining({
      payload: { projectId: projectRecord.projectId },
    }));
    expect(useProjectStore.getState().currentProjectId).toBe(projectRecord.projectId);
  });

  it('keeps existing project order and display metadata when selecting a known project', async () => {
    const otherProjectRecord = {
      ...projectRecord,
      projectId: 'project:other',
      name: 'other',
      repoPath: 'C:/all/work/study/other',
      repoPathKey: 'c:/all/work/study/other',
      lastOpenedAt: '2026-05-18T00:00:00.000Z',
    };
    const openedOtherProjectRecord = {
      ...otherProjectRecord,
      lastOpenedAt: '2026-05-20T00:00:00.000Z',
    };
    vi.mocked(window.megumi.project.open).mockResolvedValueOnce(
      ok({ project: openedOtherProjectRecord }, IPC_CHANNELS.project.open),
    );
    useProjectStore.setState({
      projects: [
        useProjectStore.getState().mapProjectRecord(projectRecord),
        useProjectStore.getState().mapProjectRecord(otherProjectRecord),
      ],
      currentProjectId: projectRecord.projectId,
    });

    await useProjectStore.getState().openProject(otherProjectRecord.projectId);

    expect(useProjectStore.getState().currentProjectId).toBe(otherProjectRecord.projectId);
    expect(useProjectStore.getState().projects.map((project) => project.id)).toEqual([
      projectRecord.projectId,
      otherProjectRecord.projectId,
    ]);
    expect(useProjectStore.getState().projects[1]?.lastOpenedAt).toBe(otherProjectRecord.lastOpenedAt);
  });

  it('clears active session when opening a different project', async () => {
    const otherProjectRecord = {
      ...projectRecord,
      projectId: 'project:other',
      name: 'other',
      repoPath: 'C:/all/work/study/other',
      repoPathKey: 'c:/all/work/study/other',
      lastOpenedAt: '2026-05-19T00:00:02.000Z',
    };
    vi.mocked(window.megumi.project.open).mockResolvedValueOnce(
      ok({ project: otherProjectRecord }, IPC_CHANNELS.project.open),
    );
    useProjectStore.setState({
      projects: [
        useProjectStore.getState().mapProjectRecord(projectRecord),
        useProjectStore.getState().mapProjectRecord(otherProjectRecord),
      ],
      currentProjectId: projectRecord.projectId,
    });
    const session = useSessionStore.getState().createLocalSession({
      projectId: projectRecord.projectId,
      title: 'Existing session',
    });

    await useProjectStore.getState().openProject(otherProjectRecord.projectId);

    expect(useProjectStore.getState().currentProjectId).toBe(otherProjectRecord.projectId);
    expect(useSessionStore.getState().activeSessionId).toBeNull();
    expect(useSessionStore.getState().sessions.find((item) => item.id === session.id)).toEqual(session);
  });

  it('removes projects and clears current project and session state if active', async () => {
    useProjectStore.setState({
      projects: [useProjectStore.getState().mapProjectRecord(projectRecord)],
      currentProjectId: projectRecord.projectId,
    });

    // Create a session tied to the project and make it active
    const session = useSessionStore.getState().createLocalSession({
      projectId: projectRecord.projectId,
      title: 'Test session',
    });

    await useProjectStore.getState().removeProject(projectRecord.projectId);

    expect(useProjectStore.getState().projects).toEqual([]);
    expect(useProjectStore.getState().currentProjectId).toBeNull();
    expect(useSessionStore.getState().activeSessionId).toBeNull();
    expect(useSessionStore.getState().sessions.find((s) => s.id === session.id)).toEqual(session);
  });

  it('stores display-safe errors from failed project IPC', async () => {
    vi.mocked(window.megumi.project.list).mockResolvedValueOnce(fail(IPC_CHANNELS.project.list));

    await useProjectStore.getState().loadProjects();

    expect(useProjectStore.getState().error).toBe('Project service failed.');
    expect(useProjectStore.getState().loading).toBe(false);
  });
});

