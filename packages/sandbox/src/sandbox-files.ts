/* Defines the file operations that a Sandbox scope may expose to Tools. */

export interface SandboxFileAccess {
  readonly workspaceRoot?: string;
}