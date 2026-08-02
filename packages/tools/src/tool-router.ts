/* Freezes one ModelCall Tool view and routes its calls back to original handlers. */

import type { JsonValue } from '@megumi/ai';
import type {
  PermissionOperation,
  RegisteredTool,
  RouteToolCallResult,
  ToolInvocation,
  ToolRouteScope,
} from './tool-handler';
import type { ToolDefinition } from './tool';
import { validateToolInput } from './tool-input-validation';

export interface ToolRouter<TContext = unknown> {
  readonly scope: ToolRouteScope;
  definitions(): readonly ToolDefinition[];
  route(request: { readonly toolCallId: string; readonly toolName: string; readonly input: unknown }): RouteToolCallResult;
  takeForExecution(invocation: ToolInvocation): {
    readonly registered: RegisteredTool<TContext>;
    readonly operations: readonly PermissionOperation[];
    readonly invocation: ToolInvocation;
  } | undefined;
}

export function createToolRouter<TContext>(request: {
  readonly scope: ToolRouteScope;
  readonly tools: readonly RegisteredTool<TContext>[];
}): ToolRouter<TContext> {
  const selected = new Map(request.tools.map((tool) => [tool.registeredToolName, tool]));
  const invocations = new Map<string, {
    readonly invocation: ToolInvocation;
    readonly registered: RegisteredTool<TContext>;
    readonly operations: ReturnType<RegisteredTool<TContext>['handler']['operations']>;
  }>();
  return {
    scope: { ...request.scope },
    definitions: () => [...selected.values()].map((tool) => tool.definition),
    route(call) {
      const registered = selected.get(call.toolName);
      if (!registered) return failed('unknown_tool', `Tool not found in this ModelCall: ${call.toolName}`);
      const validation = validateToolInput(registered.definition.inputSchema, call.input);
      if (!validation.ok) return failed('invalid_tool_input', validation.errorMessage);
      const invocation: ToolInvocation = Object.freeze({
        invocationId: `${request.scope.modelCallId}:${call.toolCallId}`,
        ...request.scope,
        toolCallId: call.toolCallId,
        toolName: registered.registeredToolName,
        toolIdentity: Object.freeze({ ...registered.identity, registeredToolName: registered.registeredToolName }),
        input: freezeJsonValue(validation.value as JsonValue),
      });
      const operations = Object.freeze(registered.handler.operations(invocation).map(freezePermissionOperation));
      invocations.set(invocation.invocationId, { invocation, registered, operations });
      return {
        status: 'routed',
        invocation,
        operations,
        executionMode: registered.executionMode,
      };
    },
    takeForExecution(invocation) {
      if (invocation.modelCallId !== request.scope.modelCallId) return undefined;
      const retained = invocations.get(invocation.invocationId);
      if (!retained || !sameInvocation(retained.invocation, invocation)) return undefined;
      invocations.delete(invocation.invocationId);
      return {
        registered: retained.registered,
        operations: retained.operations,
        invocation: retained.invocation,
      };
    },
  };
}

function sameInvocation(expected: ToolInvocation, received: ToolInvocation): boolean {
  return expected.invocationId === received.invocationId
    && expected.runId === received.runId
    && expected.sessionId === received.sessionId
    && expected.workspaceId === received.workspaceId
    && expected.modelCallId === received.modelCallId
    && expected.toolCallId === received.toolCallId
    && expected.toolName === received.toolName
    && expected.toolIdentity.sourceId === received.toolIdentity.sourceId
    && expected.toolIdentity.namespace === received.toolIdentity.namespace
    && expected.toolIdentity.sourceToolName === received.toolIdentity.sourceToolName
    && expected.toolIdentity.registeredToolName === received.toolIdentity.registeredToolName
    && sameJsonValue(expected.input, received.input);
}

function sameJsonValue(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameJsonValue(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value]) => key in right && sameJsonValue(value, right[key]));
}

function freezeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJsonValue)) as unknown as JsonValue;
  if (value && typeof value === 'object') {
    const frozenRecord = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezeJsonValue(item)]),
    );
    for (const symbol of Object.getOwnPropertySymbols(value)) {
      Object.defineProperty(frozenRecord, symbol, {
        value: freezeJsonValue((value as Record<PropertyKey, JsonValue>)[symbol]),
        enumerable: false,
      });
    }
    return Object.freeze(frozenRecord);
  }
  return value;
}

function freezePermissionOperation(operation: PermissionOperation): PermissionOperation {
  return Object.freeze({
    ...operation,
    ...(operation.resource ? {
      resource: Object.freeze({
        ...operation.resource,
        ...(operation.resource.attributes
          ? { attributes: freezeJsonValue(operation.resource.attributes) as typeof operation.resource.attributes }
          : {}),
      }),
    } : {}),
    context: Object.freeze({
      ...operation.context,
      toolIdentity: Object.freeze({ ...operation.context.toolIdentity }),
    }),
  });
}

function failed(code: 'unknown_tool' | 'invalid_tool_input', message: string): RouteToolCallResult {
  return { status: 'failed', error: { code, message } };
}
