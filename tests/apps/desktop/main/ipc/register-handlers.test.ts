// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerWindowHandlers = vi.fn();
const registerProviderHandlers = vi.fn();
const registerChatHandlers = vi.fn();
const registerAgentHandlers = vi.fn();
const registerAgentContextHandlers = vi.fn();
const registerAgentPlanHandlers = vi.fn();
const registerAgentToolHandlers = vi.fn();
const registerAgentRecoveryHandlers = vi.fn();
const registerAgentArtifactHandlers = vi.fn();

vi.mock('@megumi/desktop/main/ipc/handlers/window.handler', () => ({ registerWindowHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/provider.handler', () => ({ registerProviderHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/chat.handler', () => ({ registerChatHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent.handler', () => ({ registerAgentHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-context.handler', () => ({ registerAgentContextHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-plan.handler', () => ({ registerAgentPlanHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-tool.handler', () => ({ registerAgentToolHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-recovery.handler', () => ({ registerAgentRecoveryHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent-artifact.handler', () => ({ registerAgentArtifactHandlers }));

describe('registerAllHandlers', () => {
  beforeEach(() => {
    registerWindowHandlers.mockReset();
    registerProviderHandlers.mockReset();
    registerChatHandlers.mockReset();
    registerAgentHandlers.mockReset();
    registerAgentContextHandlers.mockReset();
    registerAgentPlanHandlers.mockReset();
    registerAgentToolHandlers.mockReset();
    registerAgentRecoveryHandlers.mockReset();
    registerAgentArtifactHandlers.mockReset();
  });

  it('registers only existing runtime handlers when no agent service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');

    registerAllHandlers();

    expect(registerWindowHandlers).toHaveBeenCalledTimes(1);
    expect(registerProviderHandlers).toHaveBeenCalledTimes(1);
    expect(registerChatHandlers).toHaveBeenCalledTimes(1);
    expect(registerAgentHandlers).not.toHaveBeenCalled();
    expect(registerAgentContextHandlers).not.toHaveBeenCalled();
    expect(registerAgentPlanHandlers).not.toHaveBeenCalled();
    expect(registerAgentToolHandlers).not.toHaveBeenCalled();
    expect(registerAgentRecoveryHandlers).not.toHaveBeenCalled();
    expect(registerAgentArtifactHandlers).not.toHaveBeenCalled();
  });

  it('passes the runtime logger to business IPC handlers', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    registerAllHandlers({ logger });

    expect(registerProviderHandlers).toHaveBeenCalledWith(undefined, { logger });
    expect(registerChatHandlers).toHaveBeenCalledWith(undefined, { logger });
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
});
