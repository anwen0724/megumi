// Provides the Tool Execution Service public entrypoint for already-allowed tool requests.
import type {
  ExecuteToolRequest,
  JsonSchemaObject,
  ToolDefinition,
  ToolExecutionResult,
} from '../contracts/tool-contracts';
import {
  createCancelledToolResult,
  createFailedToolResult,
  normalizeRawToolResult,
} from '../core/tool-execution-result';
import type { BuiltInToolExecutor } from '../built-in-tools';
import type { ToolRegistryService } from './tool-registry-service';

export class ToolExecutionService {
  constructor(private readonly input: {
    registryService: Pick<ToolRegistryService, 'getRegisteredTool'>;
    builtInTools: BuiltInToolExecutor;
  }) {}

  async executeTool(request: ExecuteToolRequest): Promise<ToolExecutionResult> {
    if (request.options?.signal?.aborted) {
      return createCancelledToolResult({ toolName: request.toolName });
    }

    const registered = this.input.registryService.getRegisteredTool({ toolName: request.toolName });
    if (registered.type === 'not_found') {
      return createFailedToolResult({
        toolName: request.toolName,
        code: 'unknown_tool',
        message: `Tool not found: ${request.toolName}`,
      });
    }

    const validation = validateToolInput(registered.tool.definition, request.input);
    if (!validation.ok) {
      return createFailedToolResult({
        toolName: request.toolName,
        code: 'invalid_tool_input',
        message: validation.errorMessage,
      });
    }

    try {
      const rawResult = await this.input.builtInTools.execute({
        toolName: registered.tool.registeredToolName,
        input: validation.value,
        ...(request.options?.signal ? { signal: request.options.signal } : {}),
      });
      return normalizeRawToolResult({ toolName: request.toolName, rawResult });
    } catch (error) {
      return createFailedToolResult({
        toolName: request.toolName,
        code: request.options?.signal?.aborted ? 'tool_cancelled' : 'tool_execution_failed',
        message: error instanceof Error ? error.message : 'Tool execution failed',
      });
    }
  }
}

export type ToolInputValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; errorMessage: string };

export function validateToolInput(definition: ToolDefinition, input: unknown): ToolInputValidationResult {
  const failure = validateAgainstSchema(input, withDefaultRootObjectType(definition.inputSchema), '$');
  if (failure) {
    return { ok: false, errorMessage: failure };
  }
  return { ok: true, value: input };
}

function withDefaultRootObjectType(schema: JsonSchemaObject): JsonSchemaObject {
  if (typeof schema.type === 'string') {
    return schema;
  }
  return {
    ...schema,
    type: inferTypeFromSchema(schema) ?? 'object',
  };
}

function validateAgainstSchema(value: unknown, schema: Record<string, unknown>, path: string): string | undefined {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues && !enumValues.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    return formatError(path, `expected one of ${JSON.stringify(enumValues)}.`);
  }

  const expectedType = typeof schema.type === 'string' ? schema.type : inferTypeFromSchema(schema);
  if (expectedType && !matchesJsonSchemaType(value, expectedType)) {
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
        if (!(key in properties)) {
          return formatError(`${path}.${key}`, 'additional properties are not allowed.');
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value && isRecord(propertySchema)) {
        const failure = validateAgainstSchema(value[key], propertySchema, `${path}.${key}`);
        if (failure) {
          return failure;
        }
      }
    }
  }

  if (expectedType === 'array' && Array.isArray(value)) {
    if (isRecord(schema.items)) {
      for (const [index, item] of value.entries()) {
        const failure = validateAgainstSchema(item, schema.items, `${path}[${index}]`);
        if (failure) {
          return failure;
        }
      }
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

function inferTypeFromSchema(schema: Record<string, unknown>): string | undefined {
  if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) {
    return 'object';
  }
  if (schema.items !== undefined) {
    return 'array';
  }
  return undefined;
}

function matchesJsonSchemaType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isRecord(value);
    case 'string':
    case 'boolean':
      return typeof value === expectedType;
    default:
      return true;
  }
}

function formatError(path: string, reason: string): string {
  return `Invalid tool input at ${path}: ${reason}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
