// Prepares validated Tool Calls for permission and execution without executing tools or touching host resources.
import type { PermissionPolicyInput } from '../permission';
import type { JsonObject } from '../shared';
import type { ToolRegistry } from './registry';
import type { ToolCall, ToolDefinition, ToolExecutionConstraint } from './types';
import { validateToolInput } from './validation';

export interface PreparedToolExecution {
  normalizedInput: JsonObject;
  permissionInput: Omit<PermissionPolicyInput, 'mode'>;
  executionInput: JsonObject;
}

export type ToolPreflightFailureStatus = 'invalid_tool' | 'invalid_input' | 'preflight_error';

export type ToolPreflightResult =
  | {
      status: 'ready';
      toolCallId: string;
      toolName: string;
      toolDefinition: ToolDefinition;
      normalizedInput: JsonObject;
      permissionInput: Omit<PermissionPolicyInput, 'mode'>;
      executionInput: JsonObject;
      executionConstraint: ToolExecutionConstraint;
    }
  | {
      status: ToolPreflightFailureStatus;
      toolCallId: string;
      toolName: string;
      message: string;
    };

export function preflightToolCall(call: ToolCall, registry: ToolRegistry): ToolPreflightResult {
  const definition = registry.get(call.name);
  if (!definition) {
    return {
      status: 'invalid_tool',
      toolCallId: call.id,
      toolName: call.name,
      message: `Tool not found: ${call.name}`,
    };
  }

  const validation = validateToolInput(definition, call.input);
  if (!validation.ok) {
    return {
      status: 'invalid_input',
      toolCallId: call.id,
      toolName: call.name,
      message: validation.error.message,
    };
  }

  try {
    const prepared = prepareToolExecution({ ...call, input: validation.value }, definition);
    return {
      status: 'ready',
      toolCallId: call.id,
      toolName: call.name,
      toolDefinition: definition,
      normalizedInput: prepared.normalizedInput,
      permissionInput: prepared.permissionInput,
      executionInput: prepared.executionInput,
      executionConstraint: definition.execution,
    };
  } catch (error) {
    return {
      status: 'preflight_error',
      toolCallId: call.id,
      toolName: call.name,
      message: error instanceof Error ? error.message : 'Tool preflight failed.',
    };
  }
}

export function prepareToolExecution(call: ToolCall, definition: ToolDefinition): PreparedToolExecution {
  const normalizedInput = { ...call.input };
  const permissionInput = permissionInputForBuiltIn(definition.name, normalizedInput)
    ?? { operation: definition.permission.operation };

  return {
    normalizedInput,
    permissionInput,
    executionInput: normalizedInput,
  };
}

function permissionInputForBuiltIn(
  toolName: string,
  input: Record<string, unknown>,
): Omit<PermissionPolicyInput, 'mode'> | undefined {
  switch (toolName) {
    case 'read_file':
    case 'list_directory':
      return { operation: 'read', target: requireString(input, 'path') };
    case 'glob':
      return { operation: 'read', target: optionalString(input, 'cwd') ?? requireString(input, 'pattern') };
    case 'search_text':
      return { operation: 'read', target: optionalString(input, 'path') ?? '.' };
    case 'edit_file':
    case 'write_file':
      return { operation: 'write', target: requireString(input, 'path') };
    case 'run_command': {
      const command = requireString(input, 'command');
      return { operation: 'exec', command, target: optionalString(input, 'cwd') ?? command };
    }
    default:
      return undefined;
  }
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected ${key} to be a string.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}
