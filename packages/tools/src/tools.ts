/* Selects one ModelCall Tool view, routes calls, and executes retained invocations. */

import type { Sandbox } from '@megumi/sandbox';
import {
  BUILT_IN_TOOL_NAMES,
  createBuiltInToolRegistry,
  type BuiltInToolName,
} from './built-ins';
import type {
  ToolDefinition,
  ToolExecutionOptions,
  ToolExecutionResult,
  ToolSource,
} from './tool';
import type {
  RouteToolCallResult,
  ToolInvocation,
  ToolRouteScope,
} from './tool-handler';
import { createToolRouter, type ToolRouter } from './tool-router';
import { createWebFetch, type WebFetch } from './built-ins/web-fetch';
import { createWebSearch, type WebSearch, type WebSearchProvider } from './built-ins/web-search';
import type { ToolProcessDescriptor } from './built-ins/run-command';
import type { BuiltInToolContext } from './built-ins/workspace-file-access';
import {
  createCancelledToolResult,
  createFailedToolResult,
  normalizeRawToolResult,
  ToolExecutionFailure,
} from './tool-result';
import {
  executeSandboxToolInvocation,
  type ToolExecutionPolicy,
  type ToolWorkspaceChanges,
} from './sandbox-tool-executor';

export interface ModelCallToolScope extends ToolRouteScope {}

export type ToolResolutionFailure = {
  readonly code: 'workspace_not_found' | 'workspace_unavailable' | 'model_call_scope_conflict';
  readonly message: string;
};

export type ResolveModelCallToolsResult =
  | { readonly status: 'resolved'; readonly definitions: readonly ToolDefinition[] }
  | { readonly status: 'failed'; readonly failure: ToolResolutionFailure };

export interface AvailableTool {
  readonly identity: { readonly sourceId: string; readonly namespace: string; readonly sourceToolName: string };
  readonly registeredToolName: string;
  readonly source: ToolSource;
  readonly definition: ToolDefinition;
}

export interface ListAvailableToolsRequest { readonly includeDisabled?: boolean }
export interface ListAvailableToolsResult { readonly tools: readonly AvailableTool[] }

export interface RouteModelCallToolRequest extends ModelCallToolScope {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export interface ExecuteToolInvocationRequest {
  readonly invocation: ToolInvocation;
  readonly stepId?: string;
  readonly toolExecutionId?: string;
}

export interface BuiltInToolAvailability {
  isAvailable(request: { readonly toolName: BuiltInToolName }): boolean;
}

export type { ToolExecutionPolicy, ToolWorkspaceChanges } from './sandbox-tool-executor';

export interface Tools {
  resolveModelCallTools(request: ModelCallToolScope): ResolveModelCallToolsResult;
  listAvailableTools(request?: ListAvailableToolsRequest): ListAvailableToolsResult;
  routeToolCall(request: RouteModelCallToolRequest): RouteToolCallResult;
  executeToolInvocation(
    request: ExecuteToolInvocationRequest,
    options?: ToolExecutionOptions,
  ): Promise<ToolExecutionResult>;
  releaseModelCallTools(request: { readonly modelCallId: string }): void;
}

export interface ToolSettings {
  resolveWebSearch():
    | { readonly status: 'ok'; readonly settings: { readonly provider?: WebSearchProvider; readonly base_url?: string } }
    | { readonly status: 'failed' };
  readWebSearchApiKey(request: Record<string, never>):
    | { readonly status: 'found'; readonly api_key: string }
    | { readonly status: 'missing' | 'failed' };
}

export interface ToolWorkspaceCatalog {
  getWorkspace(request: { readonly workspace_id: string }):
    | { readonly status: 'found'; readonly workspace: { readonly root_path: string; readonly status: 'available' | 'missing' } }
    | { readonly status: 'not_found'; readonly workspace_id: string };
}

export interface CreateToolsRequest {
  readonly settings: ToolSettings;
  readonly workspaces: ToolWorkspaceCatalog;
  readonly workspaceChanges: ToolWorkspaceChanges;
  readonly sandbox: Sandbox;
  readonly executionPolicy: ToolExecutionPolicy;
  readonly builtInToolAvailability?: BuiltInToolAvailability;
}

interface ModelCallRegistration {
  readonly scope: ModelCallToolScope;
  readonly workspaceRoot: string;
  readonly router: ToolRouter<BuiltInToolContext>;
  readonly webSearch?: WebSearch;
  readonly webFetch: WebFetch;
}

export function createTools(request: CreateToolsRequest): Tools {
  const process = toolProcessDescriptor(request.sandbox);
  const registry = createBuiltInToolRegistry({ ...(process ? { process } : {}) });
  const routers = new Map<string, ModelCallRegistration>();
  const webFetch = createWebFetch();

  return {
    resolveModelCallTools(scope) {
      const existing = routers.get(scope.modelCallId);
      if (existing) {
        return sameScope(existing.scope, scope)
          ? { status: 'resolved', definitions: existing.router.definitions() }
          : { status: 'failed', failure: {
              code: 'model_call_scope_conflict',
              message: `ModelCall Tool scope conflicts with the existing Router: ${scope.modelCallId}`,
            } };
      }
      const workspace = request.workspaces.getWorkspace({ workspace_id: scope.workspaceId });
      if (workspace.status === 'not_found') return failedResolution('workspace_not_found', `Workspace was not found: ${scope.workspaceId}`);
      if (workspace.workspace.status !== 'available') return failedResolution('workspace_unavailable', `Workspace is unavailable: ${scope.workspaceId}`);
      const webSearch = resolveWebSearch(request.settings);
      const selected = registry.list().filter((tool) => isSelected(tool.registeredToolName, {
        availability: request.builtInToolAvailability,
        processAvailable: process !== undefined,
        webSearchAvailable: webSearch !== undefined,
      }));
      const router = createToolRouter({ scope, tools: selected });
      routers.set(scope.modelCallId, {
        scope: { ...scope },
        workspaceRoot: workspace.workspace.root_path,
        router,
        ...(webSearch ? { webSearch } : {}),
        webFetch,
      });
      return { status: 'resolved', definitions: router.definitions() };
    },

    listAvailableTools(input = {}) {
      return {
        tools: registry.list()
          .filter((tool) => input.includeDisabled || isSelected(tool.registeredToolName, {
            availability: request.builtInToolAvailability,
            processAvailable: process !== undefined,
            webSearchAvailable: resolveWebSearch(request.settings) !== undefined,
          }))
          .map((tool) => ({
            identity: tool.identity,
            registeredToolName: tool.registeredToolName,
            source: tool.source,
            definition: tool.definition,
          })),
      };
    },

    routeToolCall(input) {
      const registration = routers.get(input.modelCallId);
      if (!registration || !sameScope(registration.scope, input)) {
        return { status: 'failed', error: {
          code: 'unknown_tool',
          message: `ModelCall Tool Router was not found: ${input.modelCallId}`,
        } };
      }
      return registration.router.route({
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.input,
      });
    },

    async executeToolInvocation(input, options = {}) {
      const registration = routers.get(input.invocation.modelCallId);
      const retained = registration?.router.takeForExecution(input.invocation);
      if (!registration || !retained) {
        return createFailedToolResult({
          toolName: input.invocation.toolName,
          code: 'unknown_tool',
          message: 'The routed Tool invocation is no longer available.',
        });
      }
      const { registered, operations, invocation } = retained;
      if (options.signal?.aborted) return createCancelledToolResult({ toolName: invocation.toolName });
      if (operations.length === 0) {
        return executeHandler(registered.handler, {} as BuiltInToolContext, invocation, options);
      }
      if (!options.executionAccess) {
        return createFailedToolResult({
          toolName: invocation.toolName,
          code: 'sandbox_denied',
          message: 'Tool execution access was not provided.',
        });
      }
      return executeSandboxToolInvocation({
        sandbox: request.sandbox,
        executionPolicy: request.executionPolicy,
        workspaceChanges: request.workspaceChanges,
        workspaceRoot: registration.workspaceRoot,
        invocation,
        ...(registration.webSearch ? { webSearch: registration.webSearch } : {}),
        webFetch: registration.webFetch,
        ...(input.stepId ? { stepId: input.stepId } : {}),
        ...(input.toolExecutionId ? { toolExecutionId: input.toolExecutionId } : {}),
        options: { ...options, executionAccess: options.executionAccess },
        execute: (context) => executeHandler(registered.handler, context, invocation, options),
      });
    },

    releaseModelCallTools(input) { routers.delete(input.modelCallId); },
  };
}

async function executeHandler(
  handler: import('./tool-handler').ToolHandler<BuiltInToolContext>,
  context: BuiltInToolContext,
  invocation: ToolInvocation,
  options: ToolExecutionOptions,
): Promise<ToolExecutionResult> {
  try {
    const rawResult = await handler.execute(context, invocation, options);
    return normalizeRawToolResult({ toolName: invocation.toolName, rawResult });
  } catch (error) {
    const terminationUnconfirmed = error instanceof ToolExecutionFailure && error.code === 'termination_unconfirmed';
    const cancelled = !terminationUnconfirmed && (options.signal?.aborted
      || (error instanceof ToolExecutionFailure && error.code === 'tool_cancelled'));
    return createFailedToolResult({
      toolName: invocation.toolName,
      code: cancelled ? 'tool_cancelled' : error instanceof ToolExecutionFailure ? error.code : 'tool_execution_failed',
      message: cancelled ? 'Tool execution was cancelled' : error instanceof ToolExecutionFailure ? error.message : 'Tool execution failed',
      ...(!cancelled && error instanceof ToolExecutionFailure && error.details ? { details: error.details } : {}),
    });
  }
}

function toolProcessDescriptor(sandbox: Sandbox): ToolProcessDescriptor | undefined {
  const capabilities = sandbox.capabilities();
  return capabilities.shellKind && capabilities.shellName
    ? { shellKind: capabilities.shellKind, shellName: capabilities.shellName, executionMethod: 'shell' }
    : undefined;
}

function resolveWebSearch(settings: ToolSettings): WebSearch | undefined {
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

function isSelected(toolName: string, facts: {
  readonly availability?: BuiltInToolAvailability;
  readonly processAvailable: boolean;
  readonly webSearchAvailable: boolean;
}): boolean {
  if (facts.availability && !facts.availability.isAvailable({ toolName: toolName as BuiltInToolName })) return false;
  if (toolName === 'run_command') return facts.processAvailable;
  if (toolName === 'web_search') return facts.webSearchAvailable;
  return BUILT_IN_TOOL_NAMES.includes(toolName as BuiltInToolName);
}

function sameScope(left: ModelCallToolScope, right: ModelCallToolScope): boolean {
  return left.runId === right.runId && left.sessionId === right.sessionId
    && left.workspaceId === right.workspaceId && left.modelCallId === right.modelCallId;
}

function failedResolution(code: ToolResolutionFailure['code'], message: string): ResolveModelCallToolsResult {
  return { status: 'failed', failure: { code, message } };
}
