// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerWindowHandlers = vi.fn();
const registerProviderHandlers = vi.fn();
const registerSessionHandlers = vi.fn();
const registerRunHandlers = vi.fn();
const registerChatHandlers = vi.fn();
const registerAgentHandlers = vi.fn();
const registerAgentContextHandlers = vi.fn();
const registerAgentPlanHandlers = vi.fn();
const registerAgentToolHandlers = vi.fn();
const registerAgentRecoveryHandlers = vi.fn();
const registerAgentArtifactHandlers = vi.fn();
const registerAgentMemoryHandlers = vi.fn();

vi.mock('@megumi/desktop/main/ipc/handlers/window.handler', () => ({ registerWindowHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/provider.handler', () => ({ registerProviderHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/session.handler', () => ({ registerSessionHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/run.handler', () => ({ registerRunHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/chat.handler', () => ({ registerChatHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent.handler', () => ({ registerAgentHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-context.handler', () => ({ registerAgentContextHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-plan.handler', () => ({ registerAgentPlanHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-tool.handler', () => ({ registerAgentToolHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-recovery.handler', () => ({ registerAgentRecoveryHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-artifact.handler', () => ({ registerAgentArtifactHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-memory.handler', () => ({ registerAgentMemoryHandlers }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

describe('registerAllHandlers', () => {
  beforeEach(() => {
    registerWindowHandlers.mockReset();
    registerProviderHandlers.mockReset();
    registerSessionHandlers.mockReset();
    registerRunHandlers.mockReset();
    registerChatHandlers.mockReset();
    registerAgentHandlers.mockReset();
    registerAgentContextHandlers.mockReset();
    registerAgentPlanHandlers.mockReset();
    registerAgentToolHandlers.mockReset();
    registerAgentRecoveryHandlers.mockReset();
    registerAgentArtifactHandlers.mockReset();
    registerAgentMemoryHandlers.mockReset();
  });

  it('registers only existing runtime handlers when no session run or agent service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');

    registerAllHandlers();

    expect(registerWindowHandlers).toHaveBeenCalledTimes(1);
    expect(registerProviderHandlers).toHaveBeenCalledTimes(1);
    expect(registerSessionHandlers).not.toHaveBeenCalled();
    expect(registerRunHandlers).not.toHaveBeenCalled();
    expect(registerChatHandlers).not.toHaveBeenCalled();
    expect(registerAgentHandlers).not.toHaveBeenCalled();
    expect(registerAgentContextHandlers).not.toHaveBeenCalled();
    expect(registerAgentPlanHandlers).not.toHaveBeenCalled();
    expect(registerAgentToolHandlers).not.toHaveBeenCalled();
    expect(registerAgentRecoveryHandlers).not.toHaveBeenCalled();
    expect(registerAgentArtifactHandlers).not.toHaveBeenCalled();
    expect(registerAgentMemoryHandlers).not.toHaveBeenCalled();
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
      sendSessionMessage: vi.fn(),
      cancelSessionMessage: vi.fn(),
      listRuntimeEventsByRun: vi.fn(),
    };

    registerAllHandlers({ logger, sessionRunService });

    expect(registerProviderHandlers).toHaveBeenCalledWith(undefined, { logger });
    expect(registerSessionHandlers).toHaveBeenCalledWith(sessionRunService, { logger });
    expect(registerRunHandlers).toHaveBeenCalledWith(sessionRunService, { logger });
    expect(registerChatHandlers).toHaveBeenCalledWith(sessionRunService, { logger });
  });

  it('registers agent lifecycle handlers when an agent service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const agentService = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      startRun: vi.fn(),
    };

    registerAllHandlers({ agentService });

    expect(registerAgentHandlers).toHaveBeenCalledWith(agentService, { logger: undefined });
  });

  it('registers agent context handlers when a context service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const agentContextService = {
      getBaselineContext: vi.fn(),
      listWorkspaceSourcesByRun: vi.fn(),
    };

    registerAllHandlers({ agentContextService });

    expect(registerAgentContextHandlers).toHaveBeenCalledWith(agentContextService, { logger: undefined });
  });

  it('registers agent plan handlers when a plan service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const agentPlanService = {
      getPlanByRun: vi.fn(),
      updatePlanStatus: vi.fn(),
    };

    registerAllHandlers({ agentPlanService });

    expect(registerAgentPlanHandlers).toHaveBeenCalledWith(agentPlanService, { logger: undefined });
  });

  it('registers agent tool handlers when a tool service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const agentToolService = {
      listDefinitions: vi.fn(),
      getToolCall: vi.fn(),
      resolveApproval: vi.fn(),
    };

    registerAllHandlers({ agentToolService });

    expect(registerAgentToolHandlers).toHaveBeenCalledWith(agentToolService, { logger: undefined });
  });

  it('registers agent recovery handlers when a recovery service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const agentRecoveryService = {
      listRecoverableRuns: vi.fn(),
      resumeRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
    };

    registerAllHandlers({ agentRecoveryService });

    expect(registerAgentRecoveryHandlers).toHaveBeenCalledWith(agentRecoveryService, { logger: undefined });
  });

  it('registers agent artifact handlers when an artifact service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const agentArtifactService = {
      listByRun: vi.fn(),
      listBySession: vi.fn(),
      get: vi.fn(),
      getVersion: vi.fn(),
      createVersion: vi.fn(),
      updateStatus: vi.fn(),
      reference: vi.fn(),
    };

    registerAllHandlers({ agentArtifactService });

    expect(registerAgentArtifactHandlers).toHaveBeenCalledWith(agentArtifactService, { logger: undefined });
  });

  it('registers agent memory handlers when a memory service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const agentMemoryService = {
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

    registerAllHandlers({ agentMemoryService });

    expect(registerAgentMemoryHandlers).toHaveBeenCalledWith({
      ipcMain: expect.objectContaining({ handle: expect.any(Function) }),
      agentMemoryService,
      logger: undefined,
    });
  });
});
