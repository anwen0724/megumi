/*
 * Private in-process protocol between the Voice Input Adapter and its Node
 * Speech Worker. Carries only control requests, PCM frames, frame acks, and
 * Speech Input Events. It is a transport detail of the Adapter module and is
 * never a second business contract next to packages/voice.
 */

import type { SpeechInputEvent } from '@megumi/voice';

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

/** Static per-worker resource locations resolved by the Adapter. */
export interface VoiceInputWorkerData {
  readonly vadModelPath: string;
  readonly senseVoiceModelPath: string;
  readonly senseVoiceTokensPath: string;
}
