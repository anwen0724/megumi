// Validates Tool Call input against Tool Definition input schemas before permission or execution.
import type { JsonObject } from '../shared';
import type { ToolDefinition, ToolError } from './types';

export type ToolInputValidationResult =
  | { ok: true; value: JsonObject }
  | { ok: false; error: ToolError };

export function validateToolInput(definition: ToolDefinition, input: unknown): ToolInputValidationResult {
  const failure = validateAgainstSchema(input, withDefaultObjectType(definition.inputSchema), '$');
  if (failure) {
    return {
      ok: false,
      error: {
        code: 'TOOL_INPUT_INVALID',
        message: failure,
        retryable: false,
      },
    };
  }

  return { ok: true, value: input as JsonObject };
}

function withDefaultObjectType(schema: JsonObject): JsonObject {
  return typeof schema.type === 'string' ? schema : { ...schema, type: 'object' };
}

function validateAgainstSchema(value: unknown, schema: JsonObject, path: string): string | undefined {
  const expectedType = typeof schema.type === 'string' ? schema.type : undefined;
  if (expectedType && !matchesType(value, expectedType)) {
    return `Invalid tool input at ${path}: expected ${expectedType}.`;
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues && !enumValues.includes(value as never)) {
    return `Invalid tool input at ${path}: expected one of ${JSON.stringify(enumValues)}.`;
  }

  if (expectedType !== 'object' || !isRecord(value)) {
    return undefined;
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const property of required) {
    if (typeof property === 'string' && !(property in value)) {
      return `Invalid tool input at ${path}.${property}: missing required property.`;
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        return `Invalid tool input at ${path}.${key}: additional properties are not allowed.`;
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in value) || !isRecord(propertySchema)) {
      continue;
    }
    const failure = validateAgainstSchema(value[key], propertySchema as JsonObject, `${path}.${key}`);
    if (failure) {
      return failure;
    }
  }

  return undefined;
}

function matchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isRecord(value);
    case 'string':
      return typeof value === 'string';
    default:
      return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
