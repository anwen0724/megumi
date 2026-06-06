// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerWindowHandlers = vi.fn();
const registerProviderHandlers = vi.fn();
const registerSessionHandlers = vi.fn();
const registerRunHandlers = vi.fn();
const registerRunContextHandlers = vi.fn();
const registerPlanHandlers = vi.fn();
const registerToolHandlers = vi.fn();
const registerRecoveryHandlers = vi.fn();
const registerArtifactHandlers = vi.fn();
const registerMemoryHandlers = vi.fn();
const registerProjectHandlers = vi.fn();
const registerWorkspaceFilesHandlers = vi.fn();

vi.mock('@megumi/desktop/main/ipc/handlers/window.handler', () => ({ registerWindowHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/provider.handler', () => ({ registerProviderHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/session.handler', () => ({ registerSessionHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/run.handler', () => ({ registerRunHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/run-context.handler', () => ({ registerRunContextHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/plan.handler', () => ({ registerPlanHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/tool.handler', () => ({ registerToolHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/recovery.handler', () => ({ registerRecoveryHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/artifact.handler', () => ({ registerArtifactHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/memory.handler', () => ({ registerMemoryHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/project.handler', () => ({ registerProjectHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/workspace-files.handler', () => ({ registerWorkspaceFilesHandlers }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

describe('registerAllHandlers', () => {
  beforeEach(() => {
    registerWindowHandlers.mockReset();
    registerProviderHandlers.mockReset();
    registerSessionHandlers.mockReset();
    registerRunHandlers.mockReset();
    registerRunContextHandlers.mockReset();
    registerPlanHandlers.mockReset();
    registerToolHandlers.mockReset();
    registerRecoveryHandlers.mockReset();
    registerArtifactHandlers.mockReset();
    registerMemoryHandlers.mockReset();
    registerProjectHandlers.mockReset();
    registerWorkspaceFilesHandlers.mockReset();
  });

  it('registers only existing runtime handlers when no session run service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');

    registerAllHandlers();

    expect(registerWindowHandlers).toHaveBeenCalledTimes(1);
    expect(registerProviderHandlers).toHaveBeenCalledTimes(1);
    expect(registerSessionHandlers).not.toHaveBeenCalled();
    expect(registerRunHandlers).not.toHaveBeenCalled();
    expect(registerRunContextHandlers).not.toHaveBeenCalled();
    expect(registerPlanHandlers).not.toHaveBeenCalled();
    expect(registerToolHandlers).not.toHaveBeenCalled();
    expect(registerRecoveryHandlers).not.toHaveBeenCalled();
    expect(registerArtifactHandlers).not.toHaveBeenCalled();
    expect(registerMemoryHandlers).not.toHaveBeenCalled();
    expect(registerWorkspaceFilesHandlers).not.toHaveBeenCalled();
  });

  it('passes the runtime logger to business IPC handlers', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const sessionRunService = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      listMessagesBySession: vi.fn(),
      listTimelineMessagesBySession: vi.fn(),
      sendSessionMessage: vi.fn(),
      cancelSessionMessage: vi.fn(),
      createBranchDraft: vi.fn(),
      cancelBranchDraft: vi.fn(),
      listRunsBySession: vi.fn(),
      listRuntimeEventsByRun: vi.fn(),
    };

    registerAllHandlers({ logger, sessionRunService });

    expect(registerProviderHandlers).toHaveBeenCalledWith(undefined, { logger });
    expect(registerSessionHandlers).toHaveBeenCalledWith(sessionRunService, { logger });
    expect(registerRunHandlers).toHaveBeenCalledWith(sessionRunService, { logger });
  });

  it('registers run context handlers when a context service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const runContextService = {
      getBaselineContext: vi.fn(),
      listWorkspaceSourcesByRun: vi.fn(),
    };

    registerAllHandlers({ runContextService });

    expect(registerRunContextHandlers).toHaveBeenCalledWith(runContextService, { logger: undefined });
  });

  it('registers plan handlers when a plan service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const planService = {
      getPlanByRun: vi.fn(),
      updatePlanStatus: vi.fn(),
    };

    registerAllHandlers({ planService });

    expect(registerPlanHandlers).toHaveBeenCalledWith(planService, { logger: undefined });
  });

  it('registers tool handlers when a tool service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const toolService = {
      listDefinitions: vi.fn(),
      getToolExecution: vi.fn(),
      resolveApproval: vi.fn(),
    };

    registerAllHandlers({ toolService });

    expect(registerToolHandlers).toHaveBeenCalledWith(toolService, { logger: undefined });
  });

  it('registers recovery handlers when a recovery service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const recoveryService = {
      listRecoverableRuns: vi.fn(),
      resumeRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
      restoreWorkspaceChangeSet: vi.fn(),
    };

    registerAllHandlers({ recoveryService });

    expect(registerRecoveryHandlers).toHaveBeenCalledWith(recoveryService, { logger: undefined });
  });

  it('registers artifact handlers when an artifact service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
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

    expect(registerArtifactHandlers).toHaveBeenCalledWith(artifactService, { logger: undefined });
  });

  it('registers memory handlers when a memory service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const memoryService = {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      listCandidates: vi.fn(),
      acceptCandidate: vi.fn(),
      rejectCandidate: vi.fn(),
      archiveCandidate: vi.fn(),
      listMemories: vi.fn(),
      getMemory: vi.fn(),
      updateMemory: vi.fn(),
      archiveMemory: vi.fn(),
      deleteMemory: vi.fn(),
      disableMemory: vi.fn(),
      enableMemory: vi.fn(),
      listSourceRefs: vi.fn(),
      listAccessLogs: vi.fn(),
      recallPreview: vi.fn(),
    };

    registerAllHandlers({ memoryService });

    expect(registerMemoryHandlers).toHaveBeenCalledWith({
      ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
      memoryService,
      logger: undefined,
    });
  });

  it('registers project handlers when a project service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
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
    });
  });

  it('registers workspace files handlers when a workspace files service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const workspaceFilesService = {
      listDirectory: vi.fn(),
    };

    registerAllHandlers({ workspaceFilesService });

    expect(registerWorkspaceFilesHandlers).toHaveBeenCalledWith(
      workspaceFilesService,
      { logger: undefined },
    );
  });
});
