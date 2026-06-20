// Creates AppApi from the desktop-owned AgentRuntimePort.
import { createAppApi, type AgentRuntimePort, type AppApi } from '../../app';

export function createDesktopAppApi(options: { agentRuntime: AgentRuntimePort }): AppApi {
  return createAppApi({ agentRuntime: options.agentRuntime });
}
