/* Defines isolated process execution and stable process-level failure facts. */

export type SandboxShellKind = 'powershell' | 'cmd' | 'posix_shell';

export interface SandboxProcessRequest {
  readonly command: string;
  readonly cwd: string;
}

export interface SandboxProcessOptions {
  readonly signal: AbortSignal;
  readonly onStdout: (chunk: Uint8Array | string) => void;
  readonly onStderr: (chunk: Uint8Array | string) => void;
}

export interface SandboxProcessResult {
  readonly exitCode: number;
  readonly terminationConfirmed: true;
}

export interface SandboxProcess {
  readonly shellKind: SandboxShellKind;
  readonly shellName: string;
  readonly executionMethod: 'shell';
  run(request: SandboxProcessRequest, options: SandboxProcessOptions): Promise<SandboxProcessResult>;
}

export class SandboxProcessError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SandboxProcessError';
  }
}