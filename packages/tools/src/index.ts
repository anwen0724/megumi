/* Public Tool contracts, model-call routing, execution, and built-in composition. */

export type {
  JsonObject,
  JsonSchemaObject,
  JsonValue,
  NormalizedToolResult,
  RawToolResult,
  ToolAvailability,
  ToolDefinition,
  ToolExecutionError,
  ToolExecutionErrorCode,
  ToolExecutionMode,
  ToolExecutionObservation,
  ToolExecutionNotification,
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
  ToolSource,
  ToolSourceKind,
} from './tool';
export type {
  PermissionOperation,
  RegisteredTool,
  RouteToolCallResult,
  ToolHandler,
  ToolInvocation,
  ToolRegistration,
  ToolRouteScope,
} from './tool-handler';
export { createToolRegistry, type ToolRegistry } from './tool-registry';
export { createToolRouter, type ToolRouter } from './tool-router';
export { isSuccessfulToolExecutionResult, ToolExecutionFailure } from './tool-result';
export {
  BUILT_IN_TOOL_NAMES,
  createBuiltInToolRegistry,
  type BuiltInToolName,
} from './built-ins';
export {
  createTools,
  type AvailableTool,
  type BuiltInToolAvailability,
  type CreateToolsRequest,
  type ExecuteToolInvocationRequest,
  type ListAvailableToolsRequest,
  type ListAvailableToolsResult,
  type ModelCallToolScope,
  type ResolveModelCallToolsResult,
  type RouteModelCallToolRequest,
  type ToolExecutionPolicy,
  type ToolResolutionFailure,
  type Tools,
} from './tools';
export type { WorkspaceFileAccess } from './built-ins/workspace-file-access';
export {
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
export { createWebFetch, type WebFetch, type WebFetchResult } from './built-ins/web-fetch';
export {
  updatePlanToolDefinition,
  updatePlanToolHandler,
  type PlanStep,
  type PlanStepStatus,
  type UpdatePlanInput,
} from './built-ins/update-plan';
