/* Generates a JSON Schema for the settings file model for editor tooling. */
import { z } from 'zod';
import { SettingsFileRawSchema } from './settings-schema';

export type SettingsJsonSchemaObject = Record<string, unknown> & {
  title?: string;
  type?: string | string[];
  properties?: Record<string, SettingsJsonSchemaObject>;
  additionalProperties?: boolean | SettingsJsonSchemaObject;
};

export function createSettingsJsonSchema(): SettingsJsonSchemaObject {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Megumi settings',
    ...zodToJsonSchema(SettingsFileRawSchema),
  };
}

function zodToJsonSchema(schema: z.ZodTypeAny): SettingsJsonSchemaObject {
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodNullable) return nullableSchema(zodToJsonSchema(schema.unwrap()));
  if (schema instanceof z.ZodEffects) return zodToJsonSchema(schema.innerType());
  if (schema instanceof z.ZodString) return stringSchema(schema);
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodNumber) return numberSchema(schema);
  if (schema instanceof z.ZodEnum) return { enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { const: schema._def.value };
  if (schema instanceof z.ZodUnion) {
    return { anyOf: schema._def.options.map((option: z.ZodTypeAny) => zodToJsonSchema(option)) };
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    return { oneOf: [...schema.options.values()].map((option) => zodToJsonSchema(option)) };
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: zodToJsonSchema(schema.valueSchema) };
  }
  if (schema instanceof z.ZodObject) {
    return {
      type: 'object',
      additionalProperties: schema._def.unknownKeys !== 'strict',
      properties: Object.fromEntries(
        Object.entries(schema.shape).map(([key, value]) => [key, zodToJsonSchema(value as z.ZodTypeAny)]),
      ),
    };
  }
  throw new Error(`Unsupported settings schema node: ${schema.constructor.name}`);
}

function stringSchema(schema: z.ZodString): SettingsJsonSchemaObject {
  const jsonSchema: SettingsJsonSchemaObject = { type: 'string' };
  for (const check of schema._def.checks) {
    if (check.kind === 'min') jsonSchema.minLength = check.value;
    if (check.kind === 'max') jsonSchema.maxLength = check.value;
    if (check.kind === 'regex') jsonSchema.pattern = check.regex.source;
    if (check.kind === 'url') jsonSchema.format = 'uri';
    if (check.kind === 'datetime') jsonSchema.format = 'date-time';
  }
  return jsonSchema;
}

function numberSchema(schema: z.ZodNumber): SettingsJsonSchemaObject {
  const jsonSchema: SettingsJsonSchemaObject = { type: 'number' };
  for (const check of schema._def.checks) {
    if (check.kind === 'int') jsonSchema.type = 'integer';
    if (check.kind === 'min') {
      if (check.inclusive) jsonSchema.minimum = check.value;
      else jsonSchema.exclusiveMinimum = check.value;
    }
    if (check.kind === 'max') {
      if (check.inclusive) jsonSchema.maximum = check.value;
      else jsonSchema.exclusiveMaximum = check.value;
    }
  }
  return jsonSchema;
}

function nullableSchema(schema: SettingsJsonSchemaObject): SettingsJsonSchemaObject {
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  if (Array.isArray(schema.type)) return { ...schema, type: [...new Set([...schema.type, 'null'])] };
  return { anyOf: [schema, { type: 'null' }] };
}
