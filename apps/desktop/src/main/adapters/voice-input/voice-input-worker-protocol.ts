/*
 * Private in-process protocol between the Voice Input Adapter and its Node
 * Speech Worker. Carries only control requests, PCM frames, frame acks, and
 * Speech Input Events. It is a transport detail of the Adapter module and is
 * never a second business contract next to packages/voice. Both sides validate
 * messages against the schemas below before they touch any state machine.
 */

import { z } from 'zod';
import { SpeechInputEventSchema, type SpeechInputEvent } from '@megumi/voice';

export type VoiceInputWorkerLanguage = 'zh' | 'en' | 'auto';

export type VoiceInputWorkerRequest =
  | { readonly type: 'start'; readonly generation: number; readonly language?: VoiceInputWorkerLanguage }
  | { readonly type: 'frame'; readonly generation: number; readonly sequence: number; readonly samples: Float32Array }
  | { readonly type: 'mute'; readonly muted: boolean }
  | { readonly type: 'manual-start'; readonly generation: number }
  | { readonly type: 'manual-finish'; readonly generation: number }
  | { readonly type: 'overflow'; readonly generation: number }
  | { readonly type: 'stop'; readonly generation: number; readonly reason: 'user' | 'session_ended' | 'disposed' };

export type VoiceInputWorkerResponse =
  | { readonly type: 'frame-ack'; readonly generation: number; readonly sequence: number }
  | { readonly type: 'event'; readonly event: SpeechInputEvent };

const FrameMessageSchema = z.object({
  type: z.literal('frame'),
  generation: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  samples: z.instanceof(Float32Array).refine((samples) => samples.length === 512, {
    message: 'Worker PCM frames must contain exactly 512 samples.',
  }),
}).strict();

export const VoiceInputWorkerRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    generation: z.number().int().nonnegative(),
    language: z.enum(['zh', 'en', 'auto']).optional(),
  }).strict(),
  FrameMessageSchema,
  z.object({ type: z.literal('mute'), muted: z.boolean() }).strict(),
  z.object({ type: z.literal('manual-start'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('manual-finish'), generation: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('overflow'), generation: z.number().int().nonnegative() }).strict(),
  z.object({
    type: z.literal('stop'),
    generation: z.number().int().nonnegative(),
    reason: z.enum(['user', 'session_ended', 'disposed']),
  }).strict(),
]);

export const VoiceInputWorkerResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('frame-ack'),
    generation: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
  }).strict(),
  z.object({ type: z.literal('event'), event: SpeechInputEventSchema }).strict(),
]);

/** Validates an untrusted worker request; returns undefined for malformed input. */
export function parseVoiceInputWorkerRequest(value: unknown): VoiceInputWorkerRequest | undefined {
  const result = VoiceInputWorkerRequestSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Validates an untrusted worker response; returns undefined for malformed input. */
export function parseVoiceInputWorkerResponse(value: unknown): VoiceInputWorkerResponse | undefined {
  const result = VoiceInputWorkerResponseSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Static per-worker resource locations resolved by the Adapter. */
export interface VoiceInputWorkerData {
  readonly vadModelPath: string;
  readonly senseVoiceModelPath: string;
  readonly senseVoiceTokensPath: string;
}
