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
} from './tool-catalog';
export {
  createTools,
  type BindToolExecutionRequest,
  type BindToolExecutionResult,
  type AvailableTool,
  type BuiltInToolAvailability,
  type CreateToolsRequest,
  type RecommendationToolOperations,
  type CandidateSupplyToolOperations,
  type ExecuteToolInvocationRequest,
  type ListAvailableToolsRequest,
  type ListAvailableToolsResult,
  type ModelCallToolBinding,
  type PrepareModelCallToolsResult,
  type ToolExecutionPolicy,
  type ToolResolutionFailure,
  type Tools,
  type ToolExecutionBinding,
  type ToolExecutionSubject,
} from './tools';
export {
  submitCandidatesToolDefinition,
  type SubmitCandidatesOperation,
} from './submit-candidates';
export type { WorkspaceFileAccess } from './workspace-file-access';
export {
  type RunCommandToolInput,
  type ToolProcessAdapter,
  type ToolProcessDescriptor,
  type ToolProcessExecutionMethod,
  type ToolProcessOptions,
  type ToolProcessRequest,
  type ToolProcessResult,
  type ToolShellKind,
} from './run-command';
export {
  createBraveWebSearch,
  createBingRssWebSearch,
  createFallbackWebSearch,
  createWebSearch,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchResultItem,
  type WebSearchRuntimeConfig,
  type WebSearch,
} from './web-search';
export { resolveConfiguredWebSearch, type ToolSettings } from './tools';
export { createWebFetch, type WebFetch, type WebFetchResult } from './web-fetch';
export {
  updatePlanToolDefinition,
  updatePlanToolHandler,
  type PlanStep,
  type PlanStepStatus,
  type UpdatePlanInput,
} from './update-plan';
