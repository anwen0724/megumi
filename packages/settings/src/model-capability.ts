/*
 * Product-facing model capabilities derived from provider-neutral Model facts.
 * The AI package no longer owns this derivation; Settings defines it locally.
 */
import { z } from 'zod';
import type { Api, Model } from '@megumi/ai';

export const ModelSupportLevelSchema = z.union([z.boolean(), z.literal('unknown')]);
export type ModelSupportLevel = z.infer<typeof ModelSupportLevelSchema>;

export const ModelCapabilitiesSchema = z.object({
  streaming: ModelSupportLevelSchema.optional(),
  toolCalls: ModelSupportLevelSchema.optional(),
  thinking: ModelSupportLevelSchema.optional(),
  imageInput: ModelSupportLevelSchema.optional(),
}).strict();
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ResolvedModelCapabilitiesSchema = z.object({
  streaming: ModelSupportLevelSchema,
  toolCalls: ModelSupportLevelSchema,
  thinking: ModelSupportLevelSchema,
  imageInput: ModelSupportLevelSchema,
}).strict();
export type ResolvedModelCapabilities = z.infer<typeof ResolvedModelCapabilitiesSchema>;

export const UNKNOWN_MODEL_CAPABILITIES: ResolvedModelCapabilities = Object.freeze({
  streaming: 'unknown',
  toolCalls: 'unknown',
  thinking: 'unknown',
  imageInput: 'unknown',
});

export function capabilitiesFromModel(model: Model<Api>): ResolvedModelCapabilities {
  return {
    streaming: true,
    toolCalls: true,
    thinking: model.reasoning,
    imageInput: model.input.includes('image'),
  };
}
