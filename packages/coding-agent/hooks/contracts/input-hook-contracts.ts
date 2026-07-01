/*
 * Defines hook contracts owned by the Coding Agent hook module.
 */
import { z } from 'zod';
import { JsonObjectSchema } from '@megumi/shared/primitives/json';

export const INPUT_HOOK_ACTIONS = ['continue', 'transform', 'handled'] as const;
export const InputHookActionSchema = z.enum(INPUT_HOOK_ACTIONS);

export const InputHookInvocationSchema = z
  .object({
    hookId: z.string().min(1),
    text: z.string(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export const InputHookResultSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('continue') }).strict(),
  z
    .object({
      action: z.literal('transform'),
      text: z.string(),
      metadata: JsonObjectSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('handled'),
      reason: z.string().min(1).optional(),
      metadata: JsonObjectSchema.optional(),
    })
    .strict(),
]);

export type InputHookAction = z.infer<typeof InputHookActionSchema>;
export type InputHookInvocation = z.infer<typeof InputHookInvocationSchema>;
export type InputHookResult = z.infer<typeof InputHookResultSchema>;
