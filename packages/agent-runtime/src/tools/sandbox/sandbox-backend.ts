/* Defines the platform seam used by the generic Sandbox and resolves its implementation. */
import process from 'node:process';
import type { ToolExecutionAccess } from './sandbox-access';
import type { SandboxCapabilities } from './sandbox';
import { SandboxProcessError, type SandboxProcess } from './sandbox-process';
import { createWindowsSandboxBackend } from './windows-sandbox-backend';

export interface SandboxBackendCapabilitiesRequest {
  readonly executionAccess: ToolExecutionAccess;
}

export interface CreateSandboxBackendProcessRequest {
  readonly workspaceRoot: string;
  readonly executionAccess: ToolExecutionAccess;
  readonly maxProcessCount: number;
}

export interface SandboxBackend {
  readonly platform: NodeJS.Platform;
  capabilities(request: SandboxBackendCapabilitiesRequest): SandboxCapabilities;
  createProcess(request: CreateSandboxBackendProcessRequest): SandboxProcess;
}

export function resolveSandboxBackend(
  input: { readonly platform?: NodeJS.Platform } = {},
): SandboxBackend {
  const platform = input.platform ?? process.platform;
  return platform === 'win32'
    ? createWindowsSandboxBackend()
    : createUnsupportedSandboxBackend({ platform });
}

export function createUnsupportedSandboxBackend(input: {
  readonly platform: NodeJS.Platform;
}): SandboxBackend {
  return {
    platform: input.platform,
    capabilities: () => ({
      platform: input.platform,
      shellKind: undefined,
      shellName: undefined,
      workspaceEffectObservation: false,
      fileReadBoundary: true,
      fileWriteBoundary: true,
      environmentIsolation: false,
      networkIsolation: false,
      processTreeTermination: false,
      timeLimit: false,
      outputLimit: false,
      processCountLimit: false,
      cpuLimit: false,
      memoryLimit: false,
    }),
    createProcess: () => unavailableProcess(input.platform),
  };
}

function unavailableProcess(platform: NodeJS.Platform): SandboxProcess {
  return {
    shellKind: 'posix_shell',
    shellName: 'Unavailable shell',
    executionMethod: 'shell',
    async run() {
      throw new SandboxProcessError(
        'sandbox_unavailable',
        `No process Sandbox Backend is implemented for ${platform}.`,
      );
    },
  };
}
