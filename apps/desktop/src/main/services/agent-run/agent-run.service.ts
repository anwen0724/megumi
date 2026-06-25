// Desktop facade over the product SessionRunService run-query methods. The run IPC
// handler depends on this facade rather than the product class directly, keeping
// the adapter boundary explicit.
import type { SessionRunService } from '@megumi/coding-agent/run';

export type DesktopAgentRunService = Pick<
  SessionRunService,
  'listRunsBySession' | 'listRuntimeEventsByRun'
>;

export function createDesktopAgentRunService(runtime: SessionRunService): DesktopAgentRunService {
  return {
    listRunsBySession: (sessionId) => runtime.listRunsBySession(sessionId),
    listRuntimeEventsByRun: (runId) => runtime.listRuntimeEventsByRun(runId),
  };
}
