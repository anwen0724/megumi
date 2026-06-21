// Composes project selection and workspace file access services for Desktop Main.
import fs from 'fs-extra';
import { ProjectRepository } from '@megumi/db/repos/project.repo';
import { createProjectService, type ProjectService } from '../services/project/project.service';
import { createWorkspaceFilesService } from '../services/workspace/workspace-files.service';
import { createWorkspaceRootAuthorizer } from '../services/security/workspace-root-authorization.service';
import type { SessionRunService } from '../services/session/session-run.service';
import { electronDialogHost, type DesktopDialogHost } from '../host/electron-dialog-host';
import { electronShellHost, type DesktopShellHost } from '../host/electron-shell-host';

export function composeProjectService(
  projectRepository: ProjectRepository,
  dialogHost: DesktopDialogHost = electronDialogHost,
) {
  return createProjectService({
    repository: projectRepository,
    chooseDirectory: () => dialogHost.chooseDirectory(),
    fileSystem: fs,
  });
}

export function composeWorkspaceFilesService(input: {
  sessionRunService: SessionRunService;
  projectService: ProjectService;
  shellHost?: DesktopShellHost;
}) {
  const shellHost = input.shellHost ?? electronShellHost;

  return createWorkspaceFilesService({
    isWorkspaceRootAllowed: createWorkspaceRootAuthorizer({
      staticRoots: [process.cwd()],
      sessionSource: input.sessionRunService,
      projectSource: input.projectService,
    }),
    openPath: (absolutePath) => shellHost.openPath(absolutePath),
  });
}
