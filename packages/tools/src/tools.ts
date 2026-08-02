/*
 * Owns Run-level Tool registration and routes every later Tool call through
 * the exact catalog that was exposed to the model for that Run.
 */

import type { Sandbox } from '@megumi/sandbox';
import type { SkillComposition, SkillService } from '@megumi/skills';
import {
  BUILT_IN_TOOL_NAMES,
  createBuiltInToolExecutor,
  resolveBuiltInToolRegistrations,
  type BuiltInToolName,
} from './built-ins';
import type {
  ExecuteToolRequest,
  ListToolsResult,
  RegisteredTool,
  ToolExecutionOptions,
  ToolExecutionResult,
} from './tool';
import {
  preflightToolExecution,
  type ToolExecutionPreflightResult,
} from './tool-executor';
import { createSandboxToolExecutor } from './sandbox-tool-executor';
import { createWebFetch, type WebFetch } from './built-ins/web-fetch';
import {
  createWebSearch,
  type WebSearch,
  type WebSearchProvider,
} from './built-ins/web-search';
import type { ToolProcessDescriptor } from './built-ins/run-command';

export interface RunToolScope {
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
}

export interface ResolveRunToolsRequest extends RunToolScope {}

export type ToolResolutionFailure = {
  readonly code: 'workspace_not_found' | 'workspace_unavailable' | 'run_scope_conflict';
  readonly message: string;
};

export type ResolveRunToolsResult =
  | { readonly status: 'resolved'; readonly registeredTools: readonly RegisteredTool[] }
  | { readonly status: 'failed'; readonly failure: ToolResolutionFailure };

export interface ListAvailableToolsRequest {
  readonly includeDisabled?: boolean;
}

export interface PreflightRunToolCallRequest extends ExecuteToolRequest {
  readonly runId: string;
}

export interface ExecuteRunToolCallRequest extends ExecuteToolRequest {
  readonly runId: string;
  readonly stepId?: string;
  readonly toolCallId?: string;
  readonly toolExecutionId?: string;
}

export interface ReleaseRunToolsRequest {
  readonly runId: string;
}

export interface BuiltInToolAvailability {
  isAvailable(request: { readonly toolName: BuiltInToolName }): boolean;
}

export interface ToolExecutionPolicy {
  readonly maxExecutionTimeMs: number;
  readonly maxOutputBytes: number;
  readonly maxProcessCount: number;
}

export interface Tools {
  resolveRunTools(request: ResolveRunToolsRequest): ResolveRunToolsResult;
  listAvailableTools(request?: ListAvailableToolsRequest): ListToolsResult;
  preflightToolCall(request: PreflightRunToolCallRequest): ToolExecutionPreflightResult;
  executeToolCall(
    request: ExecuteRunToolCallRequest,
    options?: ToolExecutionOptions,
  ): Promise<ToolExecutionResult>;
  releaseRunTools(request: ReleaseRunToolsRequest): void;
}

export interface ToolSettings {
  resolveWebSearch():
    | {
        readonly status: 'ok';
        readonly settings: {
          readonly provider?: WebSearchProvider;
          readonly base_url?: string;
        };
      }
    | { readonly status: 'failed' };
  readWebSearchApiKey(request: Record<string, never>):
    | { readonly status: 'found'; readonly api_key: string }
    | { readonly status: 'missing' | 'failed' };
}

export interface ToolWorkspaceCatalog {
  getWorkspace(request: { readonly workspace_id: string }):
    | {
        readonly status: 'found';
        readonly workspace: {
          readonly root_path: string;
          readonly status: 'available' | 'missing';
        };
      }
    | { readonly status: 'not_found'; readonly workspace_id: string };
}

export interface ToolWorkspaceChanges {
  trackToolExecution(request: {
    readonly scope?: {
      readonly workspace_id: string;
      readonly session_id: string;
      readonly run_id: string;
      readonly step_id?: string;
      readonly tool_call_id?: string;
      readonly tool_execution_id?: string;
    };
    readonly execute: () => Promise<ToolExecutionResult>;
  }): Promise<ToolExecutionResult>;
}

export interface CreateToolsRequest {
  readonly settings: ToolSettings;
  readonly workspaces: ToolWorkspaceCatalog;
  readonly workspaceChanges: ToolWorkspaceChanges;
  readonly skills: Pick<SkillComposition, 'createSkillService'>;
  readonly sandbox: Sandbox;
  readonly executionPolicy: ToolExecutionPolicy;
  readonly builtInToolAvailability?: BuiltInToolAvailability;
}

interface RunToolRegistration {
  readonly scope: RunToolScope;
  readonly workspaceRoot: string;
  readonly catalog: ReturnType<typeof resolveBuiltInToolRegistrations>['catalog'];
  readonly skills: Pick<SkillService, 'useSkill'>;
  readonly webSearch?: WebSearch;
  readonly webFetch: WebFetch;
}

export function createTools(request: CreateToolsRequest): Tools {
  const runRegistrations = new Map<string, RunToolRegistration>();
  const webFetch = createWebFetch();

  function resolveRunTools(input: ResolveRunToolsRequest): ResolveRunToolsResult {
    const existing = runRegistrations.get(input.runId);
    if (existing) {
      if (!sameRunToolScope(existing.scope, input)) {
        return {
          status: 'failed',
          failure: {
            code: 'run_scope_conflict',
            message: `Run Tool scope conflicts with the existing registration: ${input.runId}`,
          },
        };
      }
      return { status: 'resolved', registeredTools: existing.catalog.list().tools };
    }

    const workspace = request.workspaces.getWorkspace({ workspace_id: input.workspaceId });
    if (workspace.status === 'not_found') {
      return {
        status: 'failed',
        failure: {
          code: 'workspace_not_found',
          message: `Workspace was not found: ${input.workspaceId}`,
        },
      };
    }
    if (workspace.workspace.status !== 'available') {
      return {
        status: 'failed',
        failure: {
          code: 'workspace_unavailable',
          message: `Workspace is unavailable: ${input.workspaceId}`,
        },
      };
    }

    const process = toolProcessDescriptor(request.sandbox);
    const skills = request.skills.createSkillService({ workspaceRoot: workspace.workspace.root_path });
    const webSearch = resolveWebSearch(request.settings);
    const { catalog } = resolveBuiltInToolRegistrations({
      ...(process ? { process } : {}),
      skillsAvailable: true,
      webSearchAvailable: webSearch !== undefined,
      webFetchAvailable: true,
      disabledToolNames: disabledBuiltInToolNames(request.builtInToolAvailability),
    });
    const registration: RunToolRegistration = {
      scope: { ...input },
      workspaceRoot: workspace.workspace.root_path,
      catalog,
      skills,
      ...(webSearch ? { webSearch } : {}),
      webFetch,
    };
    runRegistrations.set(input.runId, registration);
    return { status: 'resolved', registeredTools: catalog.list().tools };
  }

  return {
    resolveRunTools,

    listAvailableTools(input = {}) {
      const process = toolProcessDescriptor(request.sandbox);
      const webSearch = resolveWebSearch(request.settings);
      const disabledToolNames = input.includeDisabled
        ? []
        : disabledBuiltInToolNames(request.builtInToolAvailability);
      return resolveBuiltInToolRegistrations({
        ...(process ? { process } : {}),
        skillsAvailable: true,
        webSearchAvailable: webSearch !== undefined,
        webFetchAvailable: true,
        disabledToolNames,
      }).catalog.list();
    },

    preflightToolCall(input) {
      const registration = runRegistrations.get(input.runId);
      if (!registration) return missingRunRegistrationPreflight(input.runId);
      return preflightToolExecution(registration.catalog, toolRequest(input));
    },

    async executeToolCall(input, options = {}) {
      const registration = runRegistrations.get(input.runId);
      if (!registration) return missingRunRegistrationResult(input);
      const executor = createSandboxToolExecutor({
        preflight: (toolCall) => preflightToolExecution(registration.catalog, toolCall),
        sandbox: request.sandbox,
        policy: {
          workspaceRoot: registration.workspaceRoot,
          ...request.executionPolicy,
        },
        createExecutor: (scope) => createBuiltInToolExecutor({
          catalog: registration.catalog,
          workspaceFileAccess: scope.files,
          process: scope.process,
          skills: registration.skills,
          ...(registration.webSearch ? { webSearch: registration.webSearch } : {}),
          webFetch: registration.webFetch,
        }),
        trackExecution: (execute) => request.workspaceChanges.trackToolExecution({
          scope: {
            workspace_id: registration.scope.workspaceId,
            session_id: registration.scope.sessionId,
            run_id: registration.scope.runId,
            ...(input.stepId ? { step_id: input.stepId } : {}),
            ...(input.toolCallId ? { tool_call_id: input.toolCallId } : {}),
            ...(input.toolExecutionId ? { tool_execution_id: input.toolExecutionId } : {}),
          },
          execute,
        }),
      });
      return executor.execute(toolRequest(input), options);
    },

    releaseRunTools(input) {
      runRegistrations.delete(input.runId);
    },
  };
}

function toolProcessDescriptor(sandbox: Sandbox): ToolProcessDescriptor | undefined {
  const capabilities = sandbox.capabilities();
  return capabilities.shellKind && capabilities.shellName
    ? {
        shellKind: capabilities.shellKind,
        shellName: capabilities.shellName,
        executionMethod: 'shell',
      }
    : undefined;
}

function disabledBuiltInToolNames(availability?: BuiltInToolAvailability): BuiltInToolName[] {
  if (!availability) return [];
  return BUILT_IN_TOOL_NAMES.filter((toolName) => !availability.isAvailable({ toolName }));
}

function resolveWebSearch(
  settings: ToolSettings,
): WebSearch | undefined {
  const resolved = settings.resolveWebSearch();
  if (resolved.status !== 'ok' || !resolved.settings.provider) return undefined;
  const credential = settings.readWebSearchApiKey({});
  if (credential.status !== 'found') return undefined;
  return createWebSearch({
    provider: resolved.settings.provider,
    apiKey: credential.api_key,
    ...(resolved.settings.base_url ? { baseUrl: resolved.settings.base_url } : {}),
  });
}

function sameRunToolScope(left: RunToolScope, right: RunToolScope): boolean {
  return left.runId === right.runId
    && left.sessionId === right.sessionId
    && left.workspaceId === right.workspaceId;
}

function toolRequest(request: ExecuteToolRequest): ExecuteToolRequest {
  return { toolName: request.toolName, input: request.input };
}

function missingRunRegistrationPreflight(runId: string): ToolExecutionPreflightResult {
  return {
    status: 'failed',
    error: {
      code: 'tool_execution_failed',
      message: `Run Tool registration was not found: ${runId}`,
    },
  };
}

function missingRunRegistrationResult(request: ExecuteRunToolCallRequest): ToolExecutionResult {
  const message = `Run Tool registration was not found: ${request.runId}`;
  return {
    type: 'failed',
    toolName: request.toolName,
    error: { code: 'tool_execution_failed', message },
    normalizedResult: { kind: 'error', content: message, isError: true, truncated: false },
    observation: { summary: message },
  };
}
