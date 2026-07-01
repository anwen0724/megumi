/*
 * Generates editor-facing JSON Schema from the canonical Zod settings contract.
 */
import { z } from 'zod';
import { AppSettingsRawSchema } from './settings-contracts';

export type SettingsJsonSchemaObject = Record<string, unknown> & {
  title?: string;
  type?: string | string[];
  properties?: Record<string, SettingsJsonSchemaObject>;
  additionalProperties?: boolean;
};

export function createAppSettingsJsonSchema(): SettingsJsonSchemaObject {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Megumi settings',
    ...zodToJsonSchema(AppSettingsRawSchema),
  };
}

function zodToJsonSchema(schema: z.ZodTypeAny): SettingsJsonSchemaObject {
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodNullable) {
    return nullableSchema(zodToJsonSchema(schema.unwrap()));
  }
  if (schema instanceof z.ZodEffects) {
    return zodToJsonSchema(schema.innerType());
  }
  if (schema instanceof z.ZodString) {
    return stringSchema(schema);
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (schema instanceof z.ZodNumber) {
    return numberSchema(schema);
  }
  if (schema instanceof z.ZodEnum) {
    return { enum: schema.options };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToJsonSchema(schema.element),
    };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties = Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [key, zodToJsonSchema(value as z.ZodTypeAny)]),
    );
    return {
      type: 'object',
      additionalProperties: schema._def.unknownKeys !== 'strict',
      properties,
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
  }
  return jsonSchema;
}

function numberSchema(schema: z.ZodNumber): SettingsJsonSchemaObject {
  const jsonSchema: SettingsJsonSchemaObject = { type: 'number' };
  for (const check of schema._def.checks) {
    if (check.kind === 'int') jsonSchema.type = 'integer';
    if (check.kind === 'min') {
      jsonSchema.minimum = check.inclusive ? check.value : check.value + 1;
    }
  }
  return jsonSchema;
}

function nullableSchema(schema: SettingsJsonSchemaObject): SettingsJsonSchemaObject {
  const type = schema.type;
  if (typeof type === 'string') {
    return { ...schema, type: [type, 'null'] };
  }
  if (Array.isArray(type)) {
    return { ...schema, type: [...new Set([...type, 'null'])] };
  }
  return {
    anyOf: [
      schema,
      { type: 'null' },
    ],
  };
}
