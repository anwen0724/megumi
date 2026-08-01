/* Defines stable Tool facts and execution contracts shared across Package seams. */

import type { JsonObject, JsonValue } from '@megumi/ai';

export type JsonSchemaObject = JsonObject;

export type ToolCapability =
  | 'project_read'
  | 'project_write'
  | 'command_run'
  | 'network_access'
  | 'browser_access'
  | 'mcp_tool'
  | 'secret_read'
  | 'system_integration'
  | 'external_app';

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolSideEffect =
  | 'none'
  | 'read_external'
  | 'project_file_operation'
  | 'execute_command'
  | 'access_network'
  | 'access_secret'
  | 'modify_external'
  | 'system_change';

export interface ToolAvailability {
  readonly status: 'available' | 'disabled' | 'unavailable';
  readonly reason?: string;
}

export type ToolSourceKind = 'built_in' | 'mcp' | 'plugin' | 'project_local' | 'skill';
export type ToolExecutionMode = 'parallel' | 'serial';

export interface ToolDefinition {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly inputExamples?: readonly JsonObject[];
  readonly outputSchema?: JsonSchemaObject;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
  readonly capabilities: readonly ToolCapability[];
  readonly riskLevel: ToolRiskLevel;
  readonly sideEffect: ToolSideEffect;
  readonly availability: ToolAvailability;
  readonly executionMode?: ToolExecutionMode;
  readonly permissionMetadata?: JsonObject;
  readonly modelFacingDescription?: string;
  readonly metadata?: JsonObject;
}

export interface ToolSource {
  readonly sourceId: string;
  readonly sourceKind: ToolSourceKind;
  readonly namespace: string;
  readonly displayName: string;
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly availabilityStatus: 'available' | 'unavailable' | 'unknown';
  readonly availabilityReason?: string;
}

export interface ToolIdentity {
  readonly sourceId: string;
  readonly namespace: string;
  readonly sourceToolName: string;
}

export interface ToolRegistration {
  readonly registrationId: string;
  readonly source: ToolSource;
  readonly definition: ToolDefinition;
  readonly enabled: boolean;
  readonly availability: ToolAvailability;
}

export interface RegisteredTool {
  readonly identity: ToolIdentity;
  readonly definition: ToolDefinition;
  readonly registeredToolName: string;
  readonly source: ToolSource;
  readonly status: 'available';
}

export interface ListToolsRequest {
  readonly sourceId?: string;
}

export interface ListToolsResult {
  readonly tools: readonly RegisteredTool[];
}

export interface GetToolRequest {
  readonly toolName: string;
}

export type GetToolResult =
  | { readonly status: 'found'; readonly tool: RegisteredTool }
  | { readonly status: 'not_found'; readonly toolName: string };

export interface ExecuteToolRequest {
  readonly toolName: string;
  readonly input: unknown;
}

export interface ToolExecutionOptions {
  readonly signal?: AbortSignal;
}

export type RawToolResult = {
  readonly outputKind: 'text' | 'json' | 'command' | 'file' | 'diff' | 'error';
  readonly content: unknown;
  readonly isError?: boolean;
  readonly error?: ToolExecutionError;
  readonly metadata?: JsonObject;
  readonly runtimeSources?: readonly ToolRuntimeSource[];
};

export interface NormalizedToolResult {
  readonly kind: 'text' | 'json' | 'error';
  readonly content: string;
  readonly isError: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: 'line_limit' | 'byte_limit' | 'token_budget' | 'policy';
  readonly metadata?: JsonObject;
}

export interface ToolExecutionObservation {
  readonly summary: string;
  readonly details?: JsonObject;
}

export type ToolExecutionErrorCode =
  | 'unknown_tool'
  | 'invalid_tool_input'
  | 'tool_execution_failed'
  | 'tool_cancelled';

export interface ToolExecutionError {
  readonly code: ToolExecutionErrorCode;
  readonly message: string;
  readonly details?: JsonObject;
}

export interface ToolRuntimeSource {
  readonly sourceId: string;
  readonly sourceKind: string;
  readonly text: string;
  readonly persisted: boolean;
  readonly metadata?: JsonObject;
}

export type ToolExecutionResult =
  | {
      readonly type: 'succeeded';
      readonly toolName: string;
      readonly normalizedResult: NormalizedToolResult;
      readonly observation?: ToolExecutionObservation;
      readonly runtimeSources?: readonly ToolRuntimeSource[];
      readonly metadata?: JsonObject;
    }
  | {
      readonly type: 'failed';
      readonly toolName?: string;
      readonly error: ToolExecutionError;
      readonly normalizedResult: NormalizedToolResult;
      readonly observation?: ToolExecutionObservation;
      readonly metadata?: JsonObject;
    };

export type { JsonObject, JsonValue };
