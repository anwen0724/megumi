import type { ProjectRepository } from '@megumi/db/repos/project.repo';
import type {
  ProjectListData,
  ProjectOpenData,
  ProjectOpenPayload,
  ProjectRecord,
  ProjectRemoveData,
  ProjectRemovePayload,
  ProjectUseExistingData,
} from '@megumi/shared/project';

type NodePlatform = NodeJS.Platform;

export interface DirectoryPickerResult {
  canceled: boolean;
  filePaths: string[];
}

export interface ProjectFileSystem {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  remove?(path: string): Promise<void> | void;
}

export interface CreateProjectServiceOptions {
  repository: ProjectRepository;
  chooseDirectory: () => Promise<DirectoryPickerResult>;
  fileSystem: ProjectFileSystem;
  now?: () => string;
  platform?: NodePlatform;
}

export interface ProjectService {
  listProjects(): Promise<ProjectListData['projects']>;
  useExistingProject(): Promise<ProjectUseExistingData>;
  openProject(payload: ProjectOpenPayload): Promise<ProjectOpenData['project']>;
  removeProject(payload: ProjectRemovePayload): ProjectRemoveData;
  listAuthorizedWorkspaceRoots(): string[];
}

export class ProjectPathValidationError extends Error {
  constructor(
    readonly repoPath: string,
    readonly reason: 'missing' | 'not_directory',
  ) {
    super(`Project path is invalid: ${reason}`);
    this.name = 'ProjectPathValidationError';
  }
}

export function createProjectService(options: CreateProjectServiceOptions): ProjectService {
  const now = options.now ?? (() => new Date().toISOString());
  const platform = options.platform ?? process.platform;

  async function refreshProjectStatus(project: ProjectRecord): Promise<ProjectRecord> {
    const status = await getPathStatus(project.repoPath);

    if (status !== project.status) {
      return options.repository.updateStatus(project.projectId, status) ?? project;
    }

    return project;
  }

  async function getPathStatus(repoPath: string): Promise<ProjectRecord['status']> {
    try {
      const stats = await options.fileSystem.stat(repoPath);
      return stats.isDirectory() ? 'available' : 'missing';
    } catch {
      return 'missing';
    }
  }

  async function assertDirectory(repoPath: string): Promise<void> {
    let stats: { isDirectory(): boolean };

    try {
      stats = await options.fileSystem.stat(repoPath);
    } catch {
      throw new ProjectPathValidationError(repoPath, 'missing');
    }

    if (!stats.isDirectory()) {
      throw new ProjectPathValidationError(repoPath, 'not_directory');
    }
  }

  return {
    async listProjects() {
      const projects = options.repository.listProjects();
      const refreshed = await Promise.all(projects.map(refreshProjectStatus));
      return refreshed.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
    },

    async useExistingProject() {
      const result = await options.chooseDirectory();

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
      }

      const repoPath = result.filePaths[0];
      await assertDirectory(repoPath);

      return {
        cancelled: false,
        project: options.repository.upsertFromRepoPath({
          repoPath,
          now: now(),
          status: 'available',
          platform,
        }),
      };
    },

    async openProject(payload) {
      const project = options.repository.getProject(payload.projectId);

      if (!project) {
        throw new ProjectPathValidationError(payload.projectId, 'missing');
      }

      const refreshed = await refreshProjectStatus(project);

      if (refreshed.status === 'missing') {
        return refreshed;
      }

      return options.repository.touchProject(refreshed.projectId, now()) ?? refreshed;
    },

    removeProject(payload) {
      return {
        projectId: payload.projectId,
        removed: options.repository.removeProject(payload.projectId),
      };
    },

    listAuthorizedWorkspaceRoots() {
      return options.repository
        .listProjects()
        .filter((project) => project.status === 'available')
        .map((project) => project.repoPath);
    },
  };
}

