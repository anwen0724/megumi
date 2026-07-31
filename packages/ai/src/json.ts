/*
 * Provider-neutral JSON contracts shared by AI protocol boundaries.
 */
import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export const JsonPrimitiveSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
]);

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		JsonPrimitiveSchema,
		z.array(JsonValueSchema),
		z.record(z.string(), JsonValueSchema),
	]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema);
