// Defines branch marker facts without deciding UI timeline presentation.
import { z } from 'zod';
import { JsonObjectSchema, type IsoDateTime, type JsonObject } from '../shared';
import type { BranchMarkerId, SessionId, SessionSourceEntryId } from './ids';

export const BranchMarkerSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    sourceEntryId: z.string().min(1),
    fromSourceEntryId: z.string().min(1),
    label: z.string().min(1).optional(),
    createdAt: z.string().min(1),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export interface BranchMarker {
  id: BranchMarkerId;
  sessionId: SessionId;
  sourceEntryId: SessionSourceEntryId;
  fromSourceEntryId: SessionSourceEntryId;
  label?: string;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}
