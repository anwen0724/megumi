/* Prepares one Coding configuration snapshot and binds tools to the real session. */
import {
  copyPathTool,
  createDirectoryTool,
  createFetchPageTool,
  createRunCommandTool, createSearchWebTool,
  deletePathTool,
  editFileTool,
  globTool,
  listDirectoryTool,
  movePathTool,
  readFileTool,
  searchTextTool,
  updatePlanTool,
  writeFileTool,
  type AgentConfig, type AgentExecutionPolicy, type AgentTool, type ExecutionEnvironment, type PermissionMode,
} from '@megumi/agent';
import type { Sandbox } from '@megumi/agent/sandbox/sandbox-scope';
import type { WebFetch } from '@megumi/agent/tools/builtin/web/fetch-page';
import type { WebSearch } from '@megumi/agent/tools/builtin/web/search-web';
import type { Api, Model } from '@megumi/ai';
import type { WorkspaceCatalog, WorkspaceChanges } from '../workspace/index';
import type { Session } from './sessions/session-catalog';

export interface CodingRunPreparation {
  readonly workspaces: Pick<WorkspaceCatalog, 'getWorkspace'>;
  readonly workspaceChanges: Pick<WorkspaceChanges, 'trackToolExecution'>;
  readonly sandbox: Pick<Sandbox, 'capabilities'>;
  readonly policy: AgentExecutionPolicy;
  readonly operatingSystem: string;
  readonly webSearch?: WebSearch;
  readonly webFetch: WebFetch;
}

export type CodingConfig = AgentConfig & { readonly environment: ExecutionEnvironment };

/** Freezes the chosen model, environment, policy and tool selection before starting Agent. */
export async function prepareCodingRun(request: {
  readonly session: Session;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
  readonly signal: AbortSignal;
}, dependencies: CodingRunPreparation): Promise<CodingConfig> {
  const workspace = await dependencies.workspaces.getWorkspace({ workspace_id: request.session.workspace_id });
  request.signal.throwIfAborted();
  if (workspace.status !== 'found') throw new Error('The Coding workspace is unavailable.');
  const capabilities = dependencies.sandbox.capabilities();
  const tools: AgentTool[] = [readFileTool, writeFileTool, editFileTool, listDirectoryTool, globTool,
    searchTextTool, createDirectoryTool, copyPathTool, movePathTool, deletePathTool, updatePlanTool,
    createFetchPageTool(dependencies.webFetch)];
  if (capabilities.shellKind && capabilities.shellName) {
    tools.push(createRunCommandTool({ shellKind: capabilities.shellKind, shellName: capabilities.shellName, executionMethod: 'shell' }));
  }
  if (dependencies.webSearch) tools.push(createSearchWebTool(dependencies.webSearch));
  return {
    model: request.model,
    permissionMode: request.permissionMode,
    environment: {
      workingDirectory: workspace.workspace.root_path,
      operatingSystem: dependencies.operatingSystem,
      shell: capabilities.shellName ?? 'Unavailable shell',
    },
    policy: { ...dependencies.policy },
    tools: tools.map(tool => ({
      ...tool,
      execute: (input, execution) => dependencies.workspaceChanges.trackToolExecution({
        scope: { workspace_id: request.session.workspace_id, session_id: request.session.session_id,
          execution_id: execution.runId, tool_call_id: execution.toolCallId, tool_execution_id: execution.toolCallId },
        execute: () => tool.execute(input, execution),
      }),
    })),
  };
}
