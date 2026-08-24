/* Defines the access facts selected by Permissions and enforced by one Sandbox scope. */

export type ToolExecutionFileAccess =
  | { readonly mode: 'workspace' }
  | {
      readonly mode: 'workspace_and_paths';
      readonly readablePaths: readonly string[];
      readonly writablePaths: readonly string[];
    }
  | { readonly mode: 'unrestricted' };

export interface ToolExecutionAccess {
  readonly fileSystem: ToolExecutionFileAccess;
  readonly process: 'sandboxed' | 'unrestricted';
  readonly network: 'denied' | 'unrestricted';
}