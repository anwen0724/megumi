/*
 * Defines the Desktop-only cross-window projection event for user submissions.
 * This leaf contract stays independent from Product and Electron so Preload can
 * validate events without pulling Main or native runtime modules into its bundle.
 */
import { z } from 'zod';

const SessionMessagePresentationAttachmentSchema = z.object({
  draftAttachmentId: z.string().min(1),
  type: z.enum(['image', 'file']),
  name: z.string(),
  declaredMimeType: z.string().optional(),
}).strict();

const SessionMessagePresentationBaseShape = {
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  clientMessageId: z.string().min(1),
  text: z.string(),
  attachments: z.array(SessionMessagePresentationAttachmentSchema).optional(),
  createdAt: z.string().datetime(),
};

export const SessionMessagePresentationEventSchema = z.discriminatedUnion('phase', [
  z.object({
    phase: z.literal('pending'),
    ...SessionMessagePresentationBaseShape,
  }).strict(),
  z.object({
    phase: z.literal('accepted'),
    ...SessionMessagePresentationBaseShape,
    messageId: z.string().min(1),
    runId: z.string().min(1),
  }).strict(),
]);

export type SessionMessagePresentationEvent = z.infer<typeof SessionMessagePresentationEventSchema>;
