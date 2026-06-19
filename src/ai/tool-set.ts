// Defines model-visible tools included in provider requests without owning tool execution.
import { z } from 'zod';
import { JsonObjectSchema, type JsonObject } from '../shared';

export const ToolSetEntrySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: JsonObjectSchema,
  })
  .strict();

export interface ToolSetEntry {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export const ToolSetSchema = z.array(ToolSetEntrySchema);

export type ToolSet = ToolSetEntry[];

export function defineToolSet(toolSet: ToolSet): ToolSet {
  return ToolSetSchema.parse(toolSet);
}
