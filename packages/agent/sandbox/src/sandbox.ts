/* Defines execution-isolation policy, capability disclosure, and scope lifecycle. */

import type { SandboxFileAccess } from './sandbox-files';
import type { SandboxProcess } from './sandbox-process';
import type { ToolExecutionAccess } from './sandbox-access';

export interface SandboxCapabilities {
  readonly platform: NodeJS.Platform;
  readonly shellKind?: 'powershell' | 'cmd' | 'posix_shell';
  readonly shellName?: string;
  readonly workspaceEffectObservation: boolean;
  readonly fileReadBoundary: boolean;
  readonly fileWriteBoundary: boolean;
  readonly environmentIsolation: boolean;
  readonly networkIsolation: boolean;
  readonly processTreeTermination: boolean;
  readonly timeLimit: boolean;
  readonly outputLimit: boolean;
  readonly processCountLimit: boolean;
  readonly cpuLimit: boolean;
  readonly memoryLimit: boolean;
}

export interface SandboxPolicy {
  readonly workspaceRoot: string;
  readonly executionAccess: ToolExecutionAccess;
  readonly maxExecutionTimeMs: number;
  readonly maxOutputBytes: number;
  readonly maxProcessCount: number;
  readonly maxCpuTimeMs?: number;
  readonly maxMemoryBytes?: number;
}

export interface OpenSandboxRequest {
  readonly policy: SandboxPolicy;
  readonly signal?: AbortSignal;
}

export type OpenSandboxResult =
  | { readonly status: 'opened'; readonly scope: SandboxScope }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface SandboxScope {
  readonly capabilities: SandboxCapabilities;
  readonly files: SandboxFileAccess;
  readonly process: SandboxProcess;
  close(): Promise<{ readonly status: 'closed' | 'termination_unconfirmed' }>;
}

export interface Sandbox {
  capabilities(): SandboxCapabilities;
  open(request: OpenSandboxRequest): Promise<OpenSandboxResult>;
}