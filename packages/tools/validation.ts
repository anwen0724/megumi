import type { JsonObject } from '@megumi/shared/json';
import type { ToolDefinition } from '@megumi/shared/tool-contracts';

export type ToolInputValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; errorMessage: string };

export function validateToolInput(
  definition: ToolDefinition,
  input: unknown,
): ToolInputValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errorMessage: 'Tool input must be an object.' };
  }

  const schema = definition.inputSchema as JsonObject;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const property of required) {
    if (typeof property === 'string' && !(property in input)) {
      return { ok: false, errorMessage: `Missing required property: ${property}` };
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in input) || !isRecord(propertySchema)) {
      continue;
    }
    const expectedType = propertySchema.type;
    if (typeof expectedType === 'string' && !matchesJsonSchemaType(input[key], expectedType)) {
      return {
        ok: false,
        errorMessage: `Invalid property type: ${key} must be ${expectedType}.`,
      };
    }
  }

  return { ok: true, value: input };
}

function matchesJsonSchemaType(value: unknown, expectedType: string): boolean {
  if (expectedType === 'array') {
    return Array.isArray(value);
  }
  if (expectedType === 'integer') {
    return Number.isInteger(value);
  }
  if (expectedType === 'object') {
    return isRecord(value);
  }
  return typeof value === expectedType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
