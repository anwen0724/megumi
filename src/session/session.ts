// Owns persisted Session facts; session state rules live in state.ts.
import { z } from 'zod';
import { JsonObjectSchema, type IsoDateTime, type JsonObject } from '../shared';
import type { SessionId } from './ids';

export const SessionStatusSchema = z.enum(['active', 'archived']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: SessionStatusSchema,
    workspaceId: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export interface Session {
  id: SessionId;
  title: string;
  status: SessionStatus;
  workspaceId?: string;
  workspacePath?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  metadata?: JsonObject;
}
