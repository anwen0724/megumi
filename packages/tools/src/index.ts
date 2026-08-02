/* Public interface for Tool contracts, Catalog, Executor, and built-in adapter composition. */

export type {
  ExecuteToolRequest,
  GetToolRequest,
  GetToolResult,
  JsonObject,
  JsonSchemaObject,
  JsonValue,
  ListToolsRequest,
  ListToolsResult,
  NormalizedToolResult,
  RegisteredTool,
  ToolAvailability,
  ToolCapability,
  ToolDefinition,
  ToolExecutionError,
  ToolExecutionErrorCode,
  ToolExecutionMode,
  ToolExecutionObservation,
  ToolExecutionOutputChunk,
  ToolExecutionAccess,
  ToolExecutionFileAccess,
  ToolExecutionOptions,
  ToolExecutionResult,
  ToolEffect,
  ToolEffectPath,
  ToolEffectReport,
  ToolIdentity,
  ToolItemFailure,
  ToolRegistration,
  ToolRiskLevel,
  ToolRuntimeSource,
  ToolSideEffect,
  ToolSource,
  ToolSourceKind,
} from './tool';
export {
  createToolCatalog,
  type CreateToolCatalogRequest,
  type ToolCatalog,
} from './tool-catalog';
export {
  createToolExecutor,
  preflightToolExecution,
  type CreateToolExecutorRequest,
  type ToolExecutionAdapter,
  type ToolExecutionPreflightResult,
  type ToolExecutor,
} from './tool-executor';
export {
  isSuccessfulToolExecutionResult,
  ToolExecutionFailure,
} from './tool-result';
export {
  BUILT_IN_TOOL_NAMES,
  createBuiltInToolExecutor,
  createBuiltInTools,
  resolveBuiltInToolRegistrations,
  type BuiltInToolName,
  type CreateBuiltInToolExecutorRequest,
  type CreateBuiltInToolsRequest,
  type CreateBuiltInToolsResult,
  type ResolveBuiltInToolRegistrationsRequest,
  type ResolveBuiltInToolRegistrationsResult,
} from './built-ins';
export {
  createTools,
  type BuiltInToolAvailability,
  type CreateToolsRequest,
  type ExecuteRunToolCallRequest,
  type ListAvailableToolsRequest,
  type PreflightRunToolCallRequest,
  type ReleaseRunToolsRequest,
  type ResolveRunToolsRequest,
  type ResolveRunToolsResult,
  type RunToolScope,
  type ToolExecutionPolicy,
  type ToolResolutionFailure,
  type Tools,
} from './tools';
export type { SkillUse, WorkspaceFileAccess } from './built-ins/workspace-file-access';
export {
  mapSkillScriptExecutionRequestToRunCommandInput,
  type RunCommandToolInput,
  type ToolProcessAdapter,
  type ToolProcessDescriptor,
  type ToolProcessExecutionMethod,
  type ToolProcessOptions,
  type ToolProcessRequest,
  type ToolProcessResult,
  type ToolShellKind,
} from './built-ins/run-command';
export {
  createBraveWebSearch,
  createWebSearch,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchResultItem,
  type WebSearchRuntimeConfig,
  type WebSearch,
} from './built-ins/web-search';
export {
  createWebFetch,
  type WebFetch,
  type WebFetchResult,
} from './built-ins/web-fetch';

export { createSandboxToolExecutor } from './sandbox-tool-executor';
export type { CreateSandboxToolExecutorRequest } from './sandbox-tool-executor';
