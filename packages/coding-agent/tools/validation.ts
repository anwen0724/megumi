// Validates provider tool call input against Coding Agent tool definitions using a JSON Schema subset.
import type { JsonObject } from '@megumi/shared/primitives';
import type { ToolDefinition } from '@megumi/shared/tool';

export type ToolInputValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; errorMessage: string };

export function validateToolInput(
  definition: ToolDefinition,
  input: unknown,
): ToolInputValidationResult {
  const schema = definition.inputSchema as JsonObject;
  const failure = validateAgainstSchema(input, withDefaultRootObjectType(schema), '$');
  if (failure) {
    return { ok: false, errorMessage: failure };
  }

  return { ok: true, value: input };
}

function withDefaultRootObjectType(schema: JsonObject): JsonObject {
  if (typeof schema.type === 'string') {
    return schema;
  }

  return {
    ...schema,
    type: inferTypeFromSchema(schema) ?? 'object',
  };
}

function validateAgainstSchema(value: unknown, schema: JsonObject, path: string): string | undefined {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues && !enumValues.some((candidate) => jsonValuesEqual(candidate, value))) {
    return formatError(path, `expected one of ${JSON.stringify(enumValues)}.`);
  }

  const expectedType = typeof schema.type === 'string'
    ? schema.type
    : inferTypeFromSchema(schema);
  if (expectedType && !matchesJsonSchemaType(value, expectedType)) {
    return formatError(path, `expected ${expectedType}.`);
  }

  if (expectedType === 'string' && typeof value === 'string') {
    const minLength = typeof schema.minLength === 'number' ? schema.minLength : undefined;
    if (minLength !== undefined && value.length < minLength) {
      return formatError(path, `expected string with minLength ${minLength}.`);
    }

    const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : undefined;
    if (maxLength !== undefined && value.length > maxLength) {
      return formatError(path, `expected string with maxLength ${maxLength}.`);
    }
  }

  if ((expectedType === 'number' || expectedType === 'integer') && typeof value === 'number') {
    const minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined;
    if (minimum !== undefined && value < minimum) {
      return formatError(path, `expected ${expectedType} >= ${minimum}.`);
    }

    const maximum = typeof schema.maximum === 'number' ? schema.maximum : undefined;
    if (maximum !== undefined && value > maximum) {
      return formatError(path, `expected ${expectedType} <= ${maximum}.`);
    }
  }

  if (expectedType === 'array' && Array.isArray(value)) {
    if (isRecord(schema.items)) {
      for (const [index, item] of value.entries()) {
        const failure = validateAgainstSchema(item, schema.items as JsonObject, `${path}[${index}]`);
        if (failure) {
          return failure;
        }
      }
    }
    return undefined;
  }

  if (expectedType === 'object' && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    for (const property of required) {
      if (typeof property === 'string' && !(property in value)) {
        return formatError(pathForProperty(path, property), 'missing required property.');
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          return formatError(pathForProperty(path, key), 'additional properties are not allowed.');
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in value) || !isRecord(propertySchema)) {
        continue;
      }
      const failure = validateAgainstSchema(value[key], propertySchema as JsonObject, pathForProperty(path, key));
      if (failure) {
        return failure;
      }
    }
  }

  return undefined;
}

function inferTypeFromSchema(schema: JsonObject): string | undefined {
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

function pathForProperty(path: string, property: string): string {
  return `${path}.${property}`;
}

function formatError(path: string, reason: string): string {
  return `Invalid tool input at ${path}: ${reason}`;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

