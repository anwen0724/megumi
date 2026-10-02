/*
 * Runtime schema for the cross-process Speech Input Event contract. The Voice
 * package owns the event semantics, so the schema lives here; Main and
 * Renderer trust boundaries validate against it without duplicating copies.
 */

import { z } from 'zod';
import type { FinalTranscript, SpeechInputEvent } from './speech-input';

const VoiceSpeechFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
}).strict();

export const FinalTranscriptSchema = z.object({
  generation: z.number().int().nonnegative(),
  utteranceId: z.string().min(1),
  text: z.string(),
  language: z.enum(['zh', 'en']).optional(),
  startedAt: z.number(),
  endedAt: z.number(),
}).strict();

export const SpeechInputEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('runtime-ready'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('listening'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('speech-started'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('speech-ended'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('recognizing'), generation: z.number().int().nonnegative() }).strict(),
  z.object({
    type: z.literal('final-transcript'),
    generation: z.number().int().nonnegative(),
    transcript: FinalTranscriptSchema,
  }).strict(),
  z.object({
    type: z.literal('empty-utterance'),
    generation: z.number().int().nonnegative(),
    source: z.enum(['boundary', 'recognition']),
  }).strict(),
  z.object({
    type: z.literal('recognition-failed'),
    generation: z.number().int().nonnegative(),
    failure: VoiceSpeechFailureSchema,
  }).strict(),
  z.object({
    type: z.literal('automatic-boundary-unavailable'),
    generation: z.number().int().nonnegative(),
  }).strict(),
  z.object({ type: z.literal('audio-overflow'), generation: z.number().int().nonnegative() }).strict(),
  z.object({
    type: z.literal('runtime-failed'),
    generation: z.number().int().nonnegative(),
    failure: VoiceSpeechFailureSchema,
  }).strict(),
  z.object({ type: z.literal('stopped'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('stt-preparing'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('stt-ready'), generation: z.number().int().nonnegative() }).strict(),
  z.object({
    type: z.literal('stt-failed'),
    generation: z.number().int().nonnegative(),
    failure: VoiceSpeechFailureSchema,
  }).strict(),
]);

/** Validates an untrusted value into a typed Speech Input Event. */
export function parseSpeechInputEvent(value: unknown): SpeechInputEvent | undefined {
  const result = SpeechInputEventSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export type ParsedFinalTranscript = z.infer<typeof FinalTranscriptSchema>;
