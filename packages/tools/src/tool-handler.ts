/* Defines the internal binding and routed invocation used by the Tool runtime. */

import type { JsonValue } from './json';
import type { PermissionOperation } from '@megumi/permissions';
import type {
  RawToolResult,
  ToolAvailability,
  ToolDefinition,
  ToolExecutionMode,
  ToolExecutionOptions,
  ToolIdentity,
  ToolSource,
} from './tool';

export interface ToolInvocation {
  readonly invocationId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly modelCallId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolIdentity: ToolIdentity & { readonly registeredToolName: string };
  readonly input: JsonValue;
}

export interface ToolHandler<TContext = unknown> {
  readonly toolName: string;
  operations(invocation: ToolInvocation): readonly PermissionOperation[];
  execute(context: TContext, invocation: ToolInvocation, options?: ToolExecutionOptions): Promise<RawToolResult>;
}

export interface RegisteredTool<TContext = unknown> {
  readonly registrationId: string;
  readonly identity: ToolIdentity;
  readonly registeredToolName: string;
  readonly definition: ToolDefinition;
  readonly handler: ToolHandler<TContext>;
  readonly source: ToolSource;
  readonly availability: ToolAvailability;
  readonly executionMode: ToolExecutionMode;
}

export interface ToolRegistration<TContext = unknown> {
  readonly registrationId: string;
  readonly source: ToolSource;
  readonly definition: ToolDefinition;
  readonly handler: ToolHandler<TContext>;
  readonly availability: ToolAvailability;
  readonly executionMode?: ToolExecutionMode;
}

export interface ToolRouteScope {
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly modelCallId: string;
}

export type RouteToolCallResult =
  | {
      readonly status: 'routed';
      readonly invocation: ToolInvocation;
      readonly operations: readonly PermissionOperation[];
      readonly executionMode: ToolExecutionMode;
    }
  | { readonly status: 'failed'; readonly error: import('./tool').ToolExecutionError };

export type { PermissionOperation };
