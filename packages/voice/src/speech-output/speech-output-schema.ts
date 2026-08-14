/*
 * Runtime schema for the cross-process Speech Output Event contract. The
 * Voice package owns the event semantics, so the schema lives here; Desktop
 * Main and Renderer trust boundaries validate against it without
 * duplicating copies.
 */

import { z } from 'zod';
import type { SpeechOutputEvent } from './speech-output-runtime';

const VoiceSpeechFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
}).strict();

export const SpeechOutputEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('synthesis-started'),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('audio-chunk'),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
    sequence: z.number().int().positive(),
    final: z.boolean(),
    format: z.enum(['mp3', 'pcm']),
    sampleRate: z.number().int().positive(),
    channels: z.union([z.literal(1), z.literal(2)]),
    bytes: z.instanceof(Uint8Array),
  }).strict(),
  z.object({
    type: z.literal('completed'),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('stopped'),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
    reason: z.enum(['replaced', 'character_hidden', 'user']),
  }).strict(),
  z.object({
    type: z.literal('error'),
    runId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    failure: VoiceSpeechFailureSchema,
  }).strict(),
]);

/** Validates an untrusted value into a typed Speech Output Event. */
export function parseSpeechOutputEvent(value: unknown): SpeechOutputEvent | undefined {
  const result = SpeechOutputEventSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
