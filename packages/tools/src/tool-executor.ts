/* Validates and executes already-registered Tools through one normalized result path. */

import type {
  ExecuteToolRequest,
  RawToolResult,
  ToolExecutionError,
  ToolExecutionOptions,
  ToolExecutionResult,
} from './tool';
import type { ToolCatalog } from './tool-catalog';
import {
  createCancelledToolResult,
  createFailedToolResult,
  normalizeRawToolResult,
  ToolExecutionFailure,
} from './tool-result';

export interface ToolExecutor {
  preflight(request: ExecuteToolRequest): ToolExecutionPreflightResult;
  execute(request: ExecuteToolRequest, options?: ToolExecutionOptions): Promise<ToolExecutionResult>;
}

export type ToolExecutionPreflightResult =
  | { readonly status: 'ready'; readonly input: unknown }
  | { readonly status: 'failed'; readonly error: ToolExecutionError };

export interface ToolExecutionAdapter {
  execute(
    request: ExecuteToolRequest,
    options?: ToolExecutionOptions,
  ): Promise<RawToolResult>;
}

export interface CreateToolExecutorRequest {
  readonly catalog: ToolCatalog;
  readonly adapter: ToolExecutionAdapter;
}

export function createToolExecutor(request: CreateToolExecutorRequest): ToolExecutor {
  const preflight = (executeRequest: ExecuteToolRequest): ToolExecutionPreflightResult => {
    const registered = request.catalog.get({ toolName: executeRequest.toolName });
    if (registered.status === 'not_found') {
      return {
        status: 'failed',
        error: {
          code: 'unknown_tool',
          message: `Tool not found: ${executeRequest.toolName}`,
        },
      };
    }
    const validation = validateToolInput(registered.tool.definition.inputSchema, executeRequest.input);
    return validation.ok
      ? { status: 'ready', input: validation.value }
      : {
          status: 'failed',
          error: { code: 'invalid_tool_input', message: validation.errorMessage },
        };
  };
  return {
    preflight,
    async execute(executeRequest, options = {}) {
      if (options.signal?.aborted) {
        return createCancelledToolResult({ toolName: executeRequest.toolName });
      }
      const prepared = preflight(executeRequest);
      if (prepared.status === 'failed') {
        return createFailedToolResult({
          toolName: executeRequest.toolName,
          code: prepared.error.code,
          message: prepared.error.message,
          ...(prepared.error.details ? { details: prepared.error.details } : {}),
        });
      }
      const registered = request.catalog.get({ toolName: executeRequest.toolName });
      if (registered.status === 'not_found') {
        return createFailedToolResult({
          toolName: executeRequest.toolName,
          code: 'unknown_tool',
          message: `Tool not found: ${executeRequest.toolName}`,
        });
      }
      try {
        const rawResult = await request.adapter.execute({
          toolName: registered.tool.registeredToolName,
          input: prepared.input,
        }, options);
        return normalizeRawToolResult({ toolName: executeRequest.toolName, rawResult });
      } catch (error) {
        const cancelled = options.signal?.aborted || (
          error instanceof ToolExecutionFailure && error.code === 'tool_cancelled'
        );
        return createFailedToolResult({
          toolName: executeRequest.toolName,
          code: cancelled
            ? 'tool_cancelled'
            : error instanceof ToolExecutionFailure ? error.code : 'tool_execution_failed',
          message: cancelled
            ? 'Tool execution was cancelled'
            : error instanceof ToolExecutionFailure ? error.message : 'Tool execution failed',
          ...(!cancelled && error instanceof ToolExecutionFailure && error.details
            ? { details: error.details }
            : {}),
        });
      }
    },
  };
}

type ToolInputValidationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly errorMessage: string };

function validateToolInput(
  inputSchema: Record<string, unknown>,
  input: unknown,
): ToolInputValidationResult {
  const failure = validateAgainstSchema(input, inputSchema, '$');
  return failure ? { ok: false, errorMessage: failure } : { ok: true, value: input };
}

function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
): string | undefined {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues && !enumValues.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    return formatError(path, `expected one of ${JSON.stringify(enumValues)}.`);
  }
  const expectedType = typeof schema.type === 'string' ? schema.type : inferType(schema);
  if (expectedType && !matchesType(value, expectedType)) {
    return formatError(path, `expected ${expectedType}.`);
  }
  if (expectedType === 'object' && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const property of required) {
      if (typeof property === 'string' && !(property in value)) {
        return formatError(`${path}.${property}`, 'missing required property.');
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) return formatError(`${path}.${key}`, 'additional properties are not allowed.');
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value && isRecord(propertySchema)) {
        const failure = validateAgainstSchema(value[key], propertySchema, `${path}.${key}`);
        if (failure) return failure;
      }
    }
  }
  if (expectedType === 'array' && Array.isArray(value) && isRecord(schema.items)) {
    for (const [index, item] of value.entries()) {
      const failure = validateAgainstSchema(item, schema.items, `${path}[${index}]`);
      if (failure) return failure;
    }
  }
  if (expectedType === 'string' && typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      return formatError(path, `expected string length >= ${schema.minLength}.`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      return formatError(path, `expected string length <= ${schema.maxLength}.`);
    }
  }
  if ((expectedType === 'number' || expectedType === 'integer') && typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      return formatError(path, `expected value >= ${schema.minimum}.`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      return formatError(path, `expected value <= ${schema.maximum}.`);
    }
  }
  return undefined;
}

function inferType(schema: Record<string, unknown>): string | undefined {
  if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) {
    return 'object';
  }
  return schema.items !== undefined ? 'array' : undefined;
}

function matchesType(value: unknown, expectedType: string): boolean {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'integer') return Number.isInteger(value);
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expectedType === 'object') return isRecord(value);
  if (expectedType === 'string' || expectedType === 'boolean') return typeof value === expectedType;
  return true;
}

function formatError(path: string, reason: string): string {
  return `Invalid tool input at ${path}: ${reason}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
