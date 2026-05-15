// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerWindowHandlers = vi.fn();
const registerProviderHandlers = vi.fn();
const registerChatHandlers = vi.fn();
const registerAgentHandlers = vi.fn();

vi.mock('@megumi/desktop/main/ipc/handlers/window.handler', () => ({ registerWindowHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/provider.handler', () => ({ registerProviderHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/chat.handler', () => ({ registerChatHandlers }));
vi.mock('@megumi/desktop/main/ipc/handlers/agent.handler', () => ({ registerAgentHandlers }));

describe('registerAllHandlers', () => {
  beforeEach(() => {
    registerWindowHandlers.mockReset();
    registerProviderHandlers.mockReset();
    registerChatHandlers.mockReset();
    registerAgentHandlers.mockReset();
  });

  it('registers only existing runtime handlers when no agent service is provided', async () => {
    const { registerAllHandlers } = await import('@megumi/desktop/main/ipc/register-handlers');

    registerAllHandlers();

    expect(registerWindowHandlers).toHaveBeenCalledTimes(1);
    expect(registerProviderHandlers).toHaveBeenCalledTimes(1);
    expect(registerChatHandlers).toHaveBeenCalledTimes(1);
    expect(registerAgentHandlers).not.toHaveBeenCalled();
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
});
