/* Provides the real Tools runtime used by daily discovery execution tests. */
import { createTools } from '@megumi/tools';
import { createDailyDiscoveryAttempts } from '@megumi/discovery';

export function createDailyDiscoveryTestTools() {
  const attempts = createDailyDiscoveryAttempts();
  const tools = createTools({
    settings: {
      resolveWebSearch: () => ({ status: 'failed' }),
      readWebSearchApiKey: () => ({ status: 'missing' }),
    },
    workspaces: {
      getWorkspace: () => { throw new Error('Daily discovery must not resolve a Workspace.'); },
    },
    workspaceChanges: { trackToolExecution: ({ execute }) => execute() },
    sandbox: {
      capabilities: () => ({
        platform: 'win32', workspaceEffectObservation: true, fileReadBoundary: true,
        fileWriteBoundary: true, environmentIsolation: true, networkIsolation: true,
        processTreeTermination: true, timeLimit: true, outputLimit: true,
        processCountLimit: true, cpuLimit: false, memoryLimit: false,
      }),
      open: async () => ({ status: 'unavailable', reason: 'Daily discovery must not open Sandbox.' }),
    },
    executionPolicy: { maxExecutionTimeMs: 1_000, maxOutputBytes: 20_000, maxProcessCount: 4 },
    dailyDiscoveryTools: attempts,
  });
  return { tools, attempts };
}
