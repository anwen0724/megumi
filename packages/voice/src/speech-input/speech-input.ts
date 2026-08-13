/*
 * Public speech input contract owned by the Voice package: commands, states,
 * events, and the Final Transcript produced from bounded 16 kHz PCM frames.
 * The runtime behind this interface is host-neutral; hosts run it inside a
 * worker and feed it validated 512-sample frames without owning any rule here.
 */

import type { VoiceSpeechFailure } from '../speech';

/** Fixed, testable boundary parameters. There is no user-facing tuning yet. */
export interface SpeechBoundaryConfig {
  readonly sampleRate: 16000;
  readonly windowSamples: 512;
  readonly threshold: 0.5;
  readonly preRollMs: 1000;
  readonly minSpeechMs: 250;
  readonly endSilenceMs: 600;
  readonly maxUtteranceMs: 60_000;
}

export const SPEECH_BOUNDARY_CONFIG: SpeechBoundaryConfig = Object.freeze({
  sampleRate: 16000,
  windowSamples: 512,
  threshold: 0.5,
  preRollMs: 1000,
  minSpeechMs: 250,
  endSilenceMs: 600,
  maxUtteranceMs: 60_000,
});

/** One 512-sample mono 16 kHz PCM frame entering the runtime. */
export interface SpeechInputFrame {
  readonly generation: number;
  readonly sequence: number;
  readonly sampleRate: 16000;
  readonly samples: Float32Array;
}

export type SpeechInputRuntimeStatus =
  | 'starting'
  | 'listening'
  | 'speech-detected'
  | 'recognizing'
  | 'automatic-boundary-unavailable'
  | 'failed'
  | 'stopped';

export interface FinalTranscript {
  readonly generation: number;
  readonly utteranceId: string;
  readonly text: string;
  readonly language?: 'zh' | 'en';
  readonly startedAt: number;
  readonly endedAt: number;
}

export type SpeechInputEvent =
  | { readonly type: 'runtime-ready'; readonly generation: number }
  | { readonly type: 'listening'; readonly generation: number }
  | { readonly type: 'speech-started'; readonly generation: number }
  | { readonly type: 'speech-ended'; readonly generation: number }
  | { readonly type: 'recognizing'; readonly generation: number }
  | { readonly type: 'final-transcript'; readonly generation: number; readonly transcript: FinalTranscript }
  | { readonly type: 'empty-utterance'; readonly generation: number; readonly source: 'boundary' | 'recognition' }
  | { readonly type: 'recognition-failed'; readonly generation: number; readonly failure: VoiceSpeechFailure }
  | { readonly type: 'automatic-boundary-unavailable'; readonly generation: number }
  | { readonly type: 'audio-overflow'; readonly generation: number }
  | { readonly type: 'runtime-failed'; readonly generation: number; readonly failure: VoiceSpeechFailure }
  | { readonly type: 'stopped'; readonly generation: number };

export interface StartSpeechInputRequest {
  /** Hosts that own the runtime lifecycle allocate it when absent. */
  readonly generation?: number;
  readonly language?: 'zh' | 'en' | 'auto';
}

export type StartSpeechInputResult =
  | { readonly status: 'started'; readonly generation: number }
  | { readonly status: 'failed'; readonly failure: VoiceSpeechFailure };

export interface SetSpeechInputMutedRequest {
  readonly muted: boolean;
}

export interface SpeechInputGenerationRequest {
  readonly generation: number;
}

export interface StopSpeechInputRequest {
  /** Stops for a stale generation are ignored. */
  readonly generation?: number;
  readonly reason: 'user' | 'session_ended' | 'disposed';
}

/**
 * The single Voice-owned entry point for microphone speech input. Control
 * operations stay here while PCM frames arrive through acceptFrame; callers
 * cannot touch the internal utterance state machine.
 */
export interface SpeechInputRuntime {
  start(request: StartSpeechInputRequest): Promise<StartSpeechInputResult>;
  acceptFrame(frame: SpeechInputFrame): void;
  setMuted(request: SetSpeechInputMutedRequest): void;
  startManualUtterance(request: SpeechInputGenerationRequest): void;
  finishManualUtterance(request: SpeechInputGenerationRequest): void;
  stop(request: StopSpeechInputRequest): Promise<void>;
  subscribe(listener: (event: SpeechInputEvent) => void): () => void;
}
