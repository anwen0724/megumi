// Adapts entrypoint-neutral App API requests into the injected Agent Runtime port.
import type { AppApi } from './app-api';
import type { AgentRuntimePort } from './runtime-port';

export function createAppApi(options: { agentRuntime: AgentRuntimePort }): AppApi {
  return {
    async startRun(request, context) {
      return options.agentRuntime.startRun({ ...request, client: context });
    },
    async resumeRun(request, context) {
      return options.agentRuntime.resumeRun({ ...request, client: context });
    },
    async cancelRun(request, context) {
      return options.agentRuntime.cancelRun({ ...request, client: context });
    },
    async retryRun(request, context) {
      return options.agentRuntime.retryRun({ ...request, client: context });
    },
  };
}
