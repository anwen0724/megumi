// Creates AppApi from the desktop-owned AgentRuntimePort.
import { createAppApiAdapter, type AgentRuntimePort, type AppApi } from '../../app';

export function createDesktopAppApi(options: { agentRuntime: AgentRuntimePort }): AppApi {
  return createAppApiAdapter({ agentRuntime: options.agentRuntime });
}
