// Defines the public contracts exposed by the Coding Agent tools module.
import type { JsonObject, JsonValue } from '../../shared-json';

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

export type ToolAvailability = {
  status: 'available' | 'disabled' | 'unavailable';
  reason?: string;
};

export type ToolSourceKind = 'built_in' | 'mcp' | 'plugin' | 'project_local' | 'skill';

export type ToolDefinition = {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchemaObject;
  inputExamples?: JsonObject[];
  outputSchema?: JsonSchemaObject;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  capabilities: ToolCapability[];
  riskLevel: ToolRiskLevel;
  sideEffect: ToolSideEffect;
  availability: ToolAvailability;
  executionMode?: 'parallel' | 'serial';
  permissionMetadata?: JsonObject;
  modelFacingDescription?: string;
  metadata?: JsonObject;
};

export type ToolSource = {
  sourceId: string;
  sourceKind: ToolSourceKind;
  namespace: string;
  displayName: string;
  configured: boolean;
  enabled: boolean;
  availabilityStatus: 'available' | 'unavailable' | 'unknown';
  availabilityReason?: string;
};

export type ToolIdentity = {
  sourceId: string;
  namespace: string;
  sourceToolName: string;
};

export type ToolRegistration = {
  registrationId: string;
  source: ToolSource;
  definition: ToolDefinition;
  enabled: boolean;
  availability: ToolAvailability;
};

export type RegisteredTool = {
  identity: ToolIdentity;
  definition: ToolDefinition;
  registeredToolName: string;
  source: ToolSource;
  status: 'available';
};

export type ListAvailableToolsResult = {
  tools: RegisteredTool[];
};

export type GetRegisteredToolRequest = {
  toolName: string;
};

export type GetRegisteredToolResult =
  | { type: 'found'; tool: RegisteredTool }
  | { type: 'not_found'; toolName: string };

export type ExecuteToolRequest = {
  toolName: string;
  input: unknown;
  options?: ToolExecutionOptions;
};

export type ToolExecutionOptions = {
  signal?: AbortSignal;
};

export type RawToolResult = {
  outputKind: 'text' | 'json' | 'command' | 'file' | 'diff' | 'error';
  content: unknown;
  isError?: boolean;
  metadata?: JsonObject;
  runtimeSources?: ToolRuntimeSource[];
};

export type NormalizedToolResult = {
  kind: 'text' | 'json' | 'error';
  content: string;
  isError: boolean;
  truncated: boolean;
  truncationReason?: 'line_limit' | 'byte_limit' | 'token_budget' | 'policy';
  metadata?: JsonObject;
};

export type ToolExecutionObservation = {
  summary: string;
  details?: JsonObject;
};

export type ToolExecutionErrorCode =
  | 'unknown_tool'
  | 'invalid_tool_input'
  | 'tool_execution_failed'
  | 'tool_cancelled';

export type ToolExecutionError = {
  code: ToolExecutionErrorCode;
  message: string;
  details?: JsonObject;
};

export type ToolExecutionResult =
  | {
      type: 'succeeded';
      toolName: string;
      rawResult: RawToolResult;
      normalizedResult: NormalizedToolResult;
      toolExecutionObservation?: ToolExecutionObservation;
      runtimeSources?: ToolRuntimeSource[];
      metadata?: JsonObject;
    }
  | {
      type: 'failed';
      toolName?: string;
      error: ToolExecutionError;
      normalizedResult: NormalizedToolResult;
      toolExecutionObservation?: ToolExecutionObservation;
      metadata?: JsonObject;
    };

export type ToolRuntimeSource = {
  source_id: string;
  source_kind: string;
  text: string;
  persisted: boolean;
  metadata?: JsonObject;
};

export type { JsonObject, JsonValue };
