// Defines model input facts produced by context and consumed by src AI.
import { z } from 'zod';
import { MessageSchema, type Message } from './message';

export const ModelContextInputSchema = z
  .object({
    systemPrompt: z.string().optional(),
    messages: z.array(MessageSchema),
  })
  .strict()
  .transform((input) => ({
    ...input,
    messages: input.messages.filter((message) => message.role === 'user'),
  }));

export interface ModelContextInput {
  systemPrompt?: string;
  messages: Message[];
}
