// Owns session message facts independent from provider-specific AI message formats.
import { z } from 'zod';
import { JsonObjectSchema, JsonValueSchema, type IsoDateTime, type JsonObject, type JsonValue } from '../shared';
import type { SessionId, SessionMessageId } from './ids';

export const SessionMessageRoleSchema = z.enum(['user', 'assistant', 'tool_result', 'system']);
export type SessionMessageRole = z.infer<typeof SessionMessageRoleSchema>;

export const SessionMessageSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    role: SessionMessageRoleSchema,
    content: JsonValueSchema,
    createdAt: z.string().min(1),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export interface SessionMessage {
  id: SessionMessageId;
  sessionId: SessionId;
  role: SessionMessageRole;
  content: JsonValue;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}
