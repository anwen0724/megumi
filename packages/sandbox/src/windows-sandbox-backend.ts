/* Adapts the implemented Windows isolation mechanism to the Sandbox Backend contract. */
import type { SandboxCapabilities } from './sandbox';
import type { SandboxBackend } from './sandbox-backend';
import { createWindowsSandboxProcess } from './windows-sandbox-process';

const RESTRICTED_CAPABILITIES: SandboxCapabilities = {
  platform: 'win32',
  shellKind: 'powershell',
  shellName: 'Windows PowerShell',
  workspaceEffectObservation: false,
  fileReadBoundary: true,
  fileWriteBoundary: true,
  environmentIsolation: true,
  networkIsolation: true,
  processTreeTermination: true,
  timeLimit: true,
  outputLimit: true,
  processCountLimit: true,
  cpuLimit: false,
  memoryLimit: false,
};

const UNRESTRICTED_CAPABILITIES: SandboxCapabilities = {
  ...RESTRICTED_CAPABILITIES,
  fileReadBoundary: false,
  fileWriteBoundary: false,
  networkIsolation: false,
};

export function createWindowsSandboxBackend(): SandboxBackend {
  return {
    platform: 'win32',
    capabilities: ({ executionAccess }) => ({
      ...(executionAccess.process === 'unrestricted'
        ? UNRESTRICTED_CAPABILITIES
        : RESTRICTED_CAPABILITIES),
    }),
    createProcess(request) {
      return createWindowsSandboxProcess({
        workspaceRoot: request.workspaceRoot,
        maxProcessCount: request.maxProcessCount,
        isolation: request.executionAccess.process === 'unrestricted'
          ? 'unrestricted'
          : 'restricted',
      });
    },
  };
}
