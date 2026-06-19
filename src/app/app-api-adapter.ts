// Adapts entrypoint-neutral App API requests into the injected Agent Runtime port.
import type { AgentRuntimePort } from './agent-runtime-port';
import type { AppApi } from './api';
import { mapAgentRuntimeEventToAppEvent } from './event-mappers';
import { mapAgentControlResult, mapAgentRunResult, mapAgentStartResult } from './response-mappers';

export function createAppApiAdapter(options: { agentRuntime: AgentRuntimePort }): AppApi {
  const subscribers = new Set<Parameters<AppApi['subscribe']>[0]>();
  let unsubscribeRuntime: (() => void) | undefined;

  function ensureRuntimeSubscription(): void {
    if (unsubscribeRuntime) return;
    unsubscribeRuntime = options.agentRuntime.subscribe((event) => {
      const appEvent = mapAgentRuntimeEventToAppEvent(event);
      for (const subscriber of subscribers) subscriber(appEvent);
    });
  }

  return {
    async startRun(request, context) {
      const result = await options.agentRuntime.startRun({ ...request, client: context });
      return mapAgentStartResult(result);
    },
    async resumeRun(request, context) {
      const result = await options.agentRuntime.resumeRun({ ...request, client: context });
      return mapAgentRunResult(result);
    },
    async cancelRun(request, context) {
      const result = await options.agentRuntime.cancelRun({ ...request, client: context });
      return mapAgentControlResult(result);
    },
    async retryRun(request, context) {
      const result = await options.agentRuntime.retryRun({ ...request, client: context });
      return mapAgentControlResult(result);
    },
    subscribe(callback) {
      subscribers.add(callback);
      ensureRuntimeSubscription();
      return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          unsubscribeRuntime?.();
          unsubscribeRuntime = undefined;
        }
      };
    },
  };
}
