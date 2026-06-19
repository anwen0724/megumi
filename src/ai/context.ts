// Defines model input facts produced by context and consumed by src AI.
import { z } from 'zod';
import { MessageSchema, type Message } from './message';

export const ModelContextInputSchema = z
  .object({
    systemPrompt: z.string().optional(),
    messages: z.array(MessageSchema),
  })
  .strict();

export interface ModelContextInput {
  systemPrompt?: string;
  messages: Message[];
}
