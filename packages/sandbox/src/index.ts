/* Public interface for Sandbox policy, scopes, files, and process execution. */

export type { ToolExecutionAccess, ToolExecutionFileAccess } from './sandbox-access';
export type {
  OpenSandboxRequest,
  OpenSandboxResult,
  Sandbox,
  SandboxCapabilities,
  SandboxPolicy,
  SandboxScope,
} from './sandbox';
export type {
  CreateSandboxBackendProcessRequest,
  SandboxBackend,
  SandboxBackendCapabilitiesRequest,
} from './sandbox-backend';
export { createUnsupportedSandboxBackend, resolveSandboxBackend } from './sandbox-backend';
export type { SandboxFileAccess, SandboxFileEntry, SandboxTextEdit, SandboxWalkResult, SandboxWalkWarning } from './sandbox-files';
export { createNodeSandboxFileAccess, SandboxFileError } from './node-sandbox';
export { SandboxProcessError } from './sandbox-process';
export type { SandboxProcess, SandboxProcessOptions, SandboxProcessRequest, SandboxProcessResult, SandboxShellKind } from './sandbox-process';
export { createSandbox } from './sandbox-scope';
export { executeSandboxScope } from './sandbox-scope-execution';
export type { SandboxScopeExecutionResult } from './sandbox-scope-execution';
