// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerWindowHandlers = vi.fn();
const registerProviderHandlers = vi.fn();
const registerSettingsHandlers = vi.fn();
const registerSessionHandlers = vi.fn();
const registerPlanHandlers = vi.fn();
const registerToolHandlers = vi.fn();
const registerArtifactHandlers = vi.fn();
const registerProjectHandlers = vi.fn();
const registerWorkspaceFilesHandlers = vi.fn();

vi.mock('@megumi/desktop/main/ipc/handlers/window.handler', () => ({ registerWindowHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/provider.handler', () => ({ registerProviderHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/settings.handler', () => ({ registerSettingsHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/session.handler', () => ({ registerSessionHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/plan.handler', () => ({ registerPlanHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/tool.handler', () => ({ registerToolHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/artifact.handler', () => ({ registerArtifactHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/project.handler', () => ({ registerProjectHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/workspace-files.handler', () => ({ registerWorkspaceFilesHandlers }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

describe('registerAllHandlers', () => {
  beforeEach(() => {
    registerWindowHandlers.mockReset();
    registerProviderHandlers.mockReset();
    registerSettingsHandlers.mockReset();
    registerSessionHandlers.mockReset();
    registerPlanHandlers.mockReset();
    registerToolHandlers.mockReset();
    registerArtifactHandlers.mockReset();
    registerProjectHandlers.mockReset();
    registerWorkspaceFilesHandlers.mockReset();
  });

  it('registers only existing runtime handlers when no session run service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-ipc-handlers');

    registerAllHandlers();

    expect(registerWindowHandlers).toHaveBeenCalledTimes(1);
    expect(registerProviderHandlers).not.toHaveBeenCalled();
    expect(registerSettingsHandlers).not.toHaveBeenCalled();
    expect(registerSessionHandlers).not.toHaveBeenCalled();
    expect(registerPlanHandlers).not.toHaveBeenCalled();
    expect(registerToolHandlers).not.toHaveBeenCalled();
    expect(registerArtifactHandlers).not.toHaveBeenCalled();
    expect(registerWorkspaceFilesHandlers).not.toHaveBeenCalled();
  });

  it('passes the runtime logger to business IPC handlers', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-ipc-handlers');
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const flatSessionService = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      listMessagesBySession: vi.fn(),
      listTimelineMessagesBySession: vi.fn(),
      sendSessionMessage: vi.fn(),
      cancelSessionMessage: vi.fn(),
      createBranchDraft: vi.fn(),
      cancelBranchDraft: vi.fn(),
    };
    const sessionHandlers = {
      host: {
        session: {
          create: flatSessionService.createSession,
          list: flatSessionService.listSessions,
          listMessages: flatSessionService.listMessagesBySession,
          listTimeline: flatSessionService.listTimelineMessagesBySession,
          createDraft: flatSessionService.createBranchDraft,
          cancelDraft: flatSessionService.cancelBranchDraft,
        },
        input: {
          send: flatSessionService.sendSessionMessage,
          cancel: flatSessionService.cancelSessionMessage,
        },
      },
    };
    const providerService = {
      list: vi.fn(),
      update: vi.fn(),
      setApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
    };

    registerAllHandlers({ logger, providerService, sessionHandlers: sessionHandlers as any });

    expect(registerProviderHandlers).toHaveBeenCalledWith(providerService, {
      logger,
      ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
    });
    expect(registerSessionHandlers).toHaveBeenCalledWith(sessionHandlers, {
      logger,
      ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
    });
  });

  it('registers settings handlers when a settings service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-ipc-handlers');
    const settingsService = {
      get: vi.fn(),
      update: vi.fn(),
    };

    registerAllHandlers({ settingsService });

    expect(registerSettingsHandlers).toHaveBeenCalledWith({
      ipcMain: expect.any(Object),
      settingsService,
      logger: undefined,
    });
  });

  it('registers plan handlers when a plan service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-ipc-handlers');
    const planService = {
      getByRun: vi.fn(),
      updateStatus: vi.fn(),
    };

    registerAllHandlers({ planService });

    expect(registerPlanHandlers).toHaveBeenCalledWith(planService, {
      logger: undefined,
      ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
    });
  });

  it('registers permission handlers when a permissions service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-ipc-handlers');
    const permissionsService = {
      resolve: vi.fn(),
    };

    registerAllHandlers({ permissionsService });

    expect(registerToolHandlers).toHaveBeenCalledWith(permissionsService, {
      logger: undefined,
      ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
    });
  });

  it('registers artifact handlers when an artifact service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-ipc-handlers');
    const artifactService = {
      listByRun: vi.fn(),
      listBySession: vi.fn(),
      get: vi.fn(),
      getVersion: vi.fn(),
      createVersion: vi.fn(),
      updateStatus: vi.fn(),
      reference: vi.fn(),
    };

    registerAllHandlers({ artifactService });

    expect(registerArtifactHandlers).toHaveBeenCalledWith(artifactService, {
      logger: undefined,
      ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
    });
  });

  it('registers project handlers when a project service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-ipc-handlers');
    const projectService = {
      listProjects: vi.fn(),
      useExistingProject: vi.fn(),
      openProject: vi.fn(),
      removeProject: vi.fn(),
      listAuthorizedWorkspaceRoots: vi.fn(),
    };

    registerAllHandlers({ projectService });

    expect(registerProjectHandlers).toHaveBeenCalledWith(projectService, {
      logger: undefined,
      ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
    });
  });

  it('registers workspace files handlers when a workspace files service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-ipc-handlers');
    const workspaceFilesService = {
      listDirectory: vi.fn(),
      openFile: vi.fn(),
    };

    registerAllHandlers({ workspaceFilesService });

    expect(registerWorkspaceFilesHandlers).toHaveBeenCalledWith(
      workspaceFilesService,
      {
        logger: undefined,
        ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
      },
    );
  });
});
