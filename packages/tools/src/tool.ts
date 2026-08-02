/* Defines stable Tool facts and execution contracts shared across Package seams. */

import type { JsonObject, JsonValue } from '@megumi/ai';
import type { ToolExecutionAccess } from '@megumi/sandbox';
import type { PlanStep } from './built-ins/update-plan';

export type { ToolExecutionAccess, ToolExecutionFileAccess } from '@megumi/sandbox';

export type JsonSchemaObject = JsonObject;

export interface ToolAvailability {
  readonly status: 'available' | 'disabled' | 'unavailable';
  readonly reason?: string;
}

export type ToolSourceKind = 'built_in' | 'mcp' | 'plugin' | 'project_local' | 'skill';
export type ToolExecutionMode = 'parallel' | 'serial';

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly outputSchema?: JsonSchemaObject;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
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

export interface ToolExecutionOutputChunk {
  readonly stream: 'stdout' | 'stderr';
  readonly chunk: string;
  readonly truncated: boolean;
}

export type ToolExecutionNotification = {
  readonly type: 'plan_updated';
  readonly explanation?: string;
  readonly plan: readonly PlanStep[];
};


export interface ToolExecutionOptions {
  readonly signal?: AbortSignal;
  readonly onOutput?: (output: ToolExecutionOutputChunk) => void;
  readonly onNotification?: (notification: ToolExecutionNotification) => void;
  readonly executionAccess?: ToolExecutionAccess;
}

export type RawToolResult = {
  readonly outputKind: 'text' | 'json' | 'command' | 'file' | 'diff' | 'error';
  readonly content: unknown;
  readonly isError?: boolean;
  readonly error?: ToolExecutionError;
  readonly metadata?: JsonObject;
  readonly runtimeSources?: readonly ToolRuntimeSource[];
  readonly effectReport?: ToolEffectReport;
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
  | 'tool_cancelled'
  | 'path_outside_workspace'
  | 'symlink_escape'
  | 'path_not_found'
  | 'path_type_mismatch'
  | 'path_conflict'
  | 'content_conflict'
  | 'sandbox_unavailable'
  | 'sandbox_denied'
  | 'shell_unavailable'
  | 'command_failed'
  | 'tool_timeout'
  | 'termination_unconfirmed'
  | 'output_limit';

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

export interface ToolItemFailure {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ToolEffectPath {
  readonly location: 'workspace' | 'external';
  readonly path: string;
}

export type ToolEffect =
  | { readonly type: 'created'; readonly path: ToolEffectPath; readonly pathType: 'file' | 'directory' }
  | { readonly type: 'modified'; readonly path: ToolEffectPath; readonly pathType: 'file' }
  | { readonly type: 'copied'; readonly source: ToolEffectPath; readonly destination: ToolEffectPath; readonly pathType: 'file' | 'directory' }
  | { readonly type: 'moved'; readonly source: ToolEffectPath; readonly destination: ToolEffectPath; readonly pathType: 'file' | 'directory' }
  | { readonly type: 'deleted'; readonly path: ToolEffectPath; readonly pathType: 'file' | 'directory'; readonly recoverable: true };

export type ToolEffectReport =
  | { readonly coverage: 'complete'; readonly effects: readonly ToolEffect[]; readonly itemFailures: readonly ToolItemFailure[] }
  | { readonly coverage: 'unknown'; readonly effects: readonly ToolEffect[]; readonly itemFailures: readonly ToolItemFailure[]; readonly reason: string };

export type ToolExecutionResult =
  | {
      readonly type: 'succeeded';
      readonly toolName: string;
      readonly normalizedResult: NormalizedToolResult;
      readonly observation?: ToolExecutionObservation;
      readonly runtimeSources?: readonly ToolRuntimeSource[];
      readonly metadata?: JsonObject;
      readonly effectReport?: ToolEffectReport;
    }
  | {
      readonly type: 'failed';
      readonly toolName?: string;
      readonly error: ToolExecutionError;
      readonly normalizedResult: NormalizedToolResult;
      readonly observation?: ToolExecutionObservation;
      readonly metadata?: JsonObject;
      readonly effectReport?: ToolEffectReport;
    };

export type { JsonObject, JsonValue };
