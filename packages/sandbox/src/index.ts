/* Public interface for Sandbox policy, scopes, files, and process execution. */

export type {
  OpenSandboxRequest,
  OpenSandboxResult,
  Sandbox,
  SandboxCapabilities,
  SandboxPolicy,
  SandboxScope,
} from './sandbox';
export type { SandboxFileAccess, SandboxFileEntry, SandboxTextEdit } from './sandbox-files';
export { createNodeSandboxFileAccess, SandboxFileError } from './node-sandbox';
export type { SandboxProcess } from './sandbox-process';