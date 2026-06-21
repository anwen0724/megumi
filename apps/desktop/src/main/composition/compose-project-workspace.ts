// Composes project selection and workspace file access services for Desktop Main.
import fs from 'fs-extra';
import { dialog } from 'electron';
import { ProjectRepository } from '@megumi/db/repos/project.repo';
import { createProjectService, type ProjectService } from '../services/project/project.service';
import { createWorkspaceFilesService } from '../services/workspace/workspace-files.service';
import { createWorkspaceRootAuthorizer } from '../services/security/workspace-root-authorization.service';
import type { SessionRunService } from '../services/session/session-run.service';

export function composeProjectService(projectRepository: ProjectRepository) {
  return createProjectService({
    repository: projectRepository,
    chooseDirectory: () => dialog.showOpenDialog({
      properties: ['openDirectory'],
    }),
    fileSystem: fs,
  });
}

export function composeWorkspaceFilesService(input: {
  sessionRunService: SessionRunService;
  projectService: ProjectService;
}) {
  return createWorkspaceFilesService({
    isWorkspaceRootAllowed: createWorkspaceRootAuthorizer({
      staticRoots: [process.cwd()],
      sessionSource: input.sessionRunService,
      projectSource: input.projectService,
    }),
  });
}
