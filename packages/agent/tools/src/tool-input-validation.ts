/* Validates model-produced Tool input against the exposed JSON Schema. */

type ToolInputValidationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly errorMessage: string };

export function validateToolInput(inputSchema: Record<string, unknown>, input: unknown): ToolInputValidationResult {
  const failure = validateAgainstSchema(input, inputSchema, '$');
  return failure ? { ok: false, errorMessage: failure } : { ok: true, value: input };
}

function validateAgainstSchema(value: unknown, schema: Record<string, unknown>, path: string): string | undefined {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues && !enumValues.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    return formatError(path, `expected one of ${JSON.stringify(enumValues)}.`);
  }
  const expectedType = typeof schema.type === 'string' ? schema.type : inferType(schema);
  if (expectedType && !matchesType(value, expectedType)) return formatError(path, `expected ${expectedType}.`);
  if (expectedType === 'object' && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const property of required) {
      if (typeof property === 'string' && !(property in value)) return formatError(`${path}.${property}`, 'missing required property.');
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in properties)) return formatError(`${path}.${key}`, 'additional properties are not allowed.');
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
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return formatError(path, `expected string length >= ${schema.minLength}.`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return formatError(path, `expected string length <= ${schema.maxLength}.`);
  }
  if ((expectedType === 'number' || expectedType === 'integer') && typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return formatError(path, `expected value >= ${schema.minimum}.`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) return formatError(path, `expected value <= ${schema.maximum}.`);
  }
  return undefined;
}

function inferType(schema: Record<string, unknown>): string | undefined {
  if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) return 'object';
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

function formatError(path: string, reason: string): string { return `Invalid tool input at ${path}: ${reason}`; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
