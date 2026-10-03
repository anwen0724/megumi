/*
 * Keeps a tool's model declaration, permission facts and executable implementation together.
 */
import type { JsonObject, Tool } from '@megumi/ai';
import type { SandboxFileAccess } from '../sandbox/file-access';
import type { SandboxProcess } from '../sandbox/windows-process';
import type { ToolExecutionAccess } from '../sandbox/sandbox-scope';
import type { PlanStep } from './builtin/update-plan';
import type { WebSearch } from './builtin/web/search-web';
import type { WebFetch } from './builtin/web/fetch-page';
import type { ApprovalOption, ApprovalSubject, PermissionDecision } from '../permissions/authorize-tool';

export interface ToolDefinition extends Tool {
  readonly executionMode?: 'parallel' | 'serial';
  readonly promptSnippet?: string;
  readonly label?: string;
  readonly outputSchema?: JsonObject;
  readonly annotations?: { readonly readOnlyHint?: boolean; readonly destructiveHint?: boolean; readonly idempotentHint?: boolean; readonly openWorldHint?: boolean };
  readonly promptGuidelines?: readonly string[];
}

export interface PermissionOperation {
  readonly action: 'workspace.read' | 'workspace.write' | 'process.execute'
    | 'network.search' | 'network.fetch' | 'agent.context.activate' | 'external.invoke';
  readonly resource?: {
    readonly type: 'workspace.path' | 'process.command' | 'network.public_web' | 'network.url' | 'tool.identity';
    readonly id?: string;
    readonly attributes?: JsonObject;
  };
}

export type PermissionMode = 'ask' | 'auto' | 'full_access';

export interface ToolExecutionContext {
  readonly runId: string;
  readonly toolCallId: string;
  readonly signal: AbortSignal;
  readonly onOutput: (output: ToolExecutionOutputChunk) => void;
  readonly onNotification?: (notification: ToolExecutionNotification) => void;
  readonly files?: SandboxFileAccess;
  readonly process?: SandboxProcess;
}

export interface AgentTool<Input = unknown> extends ToolDefinition {
  readonly identity?: { readonly sourceId: string; readonly namespace: string; readonly sourceToolName: string };
  /** Describes the validated operation without performing it. */
  operations(input: Input): readonly PermissionOperation[];
  /** Resolves only after the actual operation and its cleanup have stopped. */
  execute(input: Input, execution: ToolExecutionContext): Promise<RawToolResult>;
}

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly operations: readonly PermissionOperation[];
  readonly signal: AbortSignal;
  readonly decision: Extract<PermissionDecision, { type: 'requires_approval' }>;
  readonly subject: ApprovalSubject;
}

export type ApprovalDecision =
  | { readonly status: 'allowed'; readonly optionId?: ApprovalOption['optionId'] }
  | { readonly status: 'denied' }
  | { readonly status: 'cancelled' };

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
  /** Observes the actual Handler result before normalization; callback failure is ignored. */
  readonly onHandlerResult?: (result: RawToolResult) => void;
  readonly executionAccess?: ToolExecutionAccess;
}

export type RawToolResult = {
  readonly outputKind: 'text' | 'json' | 'command' | 'file' | 'diff' | 'error';
  readonly content: unknown;
  readonly isError?: boolean;
  readonly error?: ToolExecutionError;
  readonly metadata?: JsonObject;
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
  | 'permission_denied'
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

export interface BuiltInToolContext {
  readonly workspaceFileAccess: SandboxFileAccess;
  readonly process?: SandboxProcess;
  readonly webSearch?: WebSearch;
  readonly webFetch?: WebFetch;
}
export type WorkspaceFileAccess = SandboxFileAccess;
export type JsonSchemaObject = JsonObject;
export type { ToolExecutionAccess } from '../sandbox/sandbox-scope';
