/* Test-only adapters exercise Tools through the same Sandbox file seam used by Product. */

import { createNodeSandboxFileAccess } from '../../../packages/sandbox/src';
import type {
  ToolProcessAdapter,
  ToolProcessOptions,
  ToolProcessRequest,
  ToolProcessResult,
  WorkspaceFileAccess,
} from '../../../packages/tools/src';

export function createLocalWorkspaceFileAccess(root: string): WorkspaceFileAccess {
  return createNodeSandboxFileAccess({ workspaceRoot: root });
}

export function createProcessAdapter(input: {
  readonly shellKind?: ToolProcessAdapter['shellKind'];
  readonly run?: (request: ToolProcessRequest, options: ToolProcessOptions) => Promise<ToolProcessResult>;
} = {}): ToolProcessAdapter {
  return {
    shellKind: input.shellKind ?? 'powershell',
    executionMethod: 'shell',
    shellName: input.shellKind === 'cmd'
      ? 'Windows Command Prompt'
      : input.shellKind === 'posix_shell' ? 'POSIX shell' : 'Windows PowerShell',
    run: input.run ?? (async (_request, options) => {
      options.onStdout('ok');
      return { exitCode: 0 };
    }),
  };
}

export function parsedToolContent(result: {
  readonly type: string;
  readonly normalizedResult: { readonly content: string };
}): unknown {
  return JSON.parse(result.normalizedResult.content);
}