/* Public interface for Sandbox policy, scopes, files, and process execution. */

export type {
  OpenSandboxRequest,
  OpenSandboxResult,
  Sandbox,
  SandboxCapabilities,
  SandboxPolicy,
  SandboxScope,
} from './sandbox';
export type { SandboxFileAccess } from './sandbox-files';
export type { SandboxProcess } from './sandbox-process';