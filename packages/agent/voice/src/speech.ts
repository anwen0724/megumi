/*
 * Defines the provider-neutral speech recognition and speech synthesis
 * seams used by the Voice runtime. Concrete sherpa and provider types stay
 * internal. The synthesis seam was re-designed for TTS v1: whole-reply
 * synthesis with streaming audio chunks; playback stays outside this seam.
 */

export interface VoiceOperationOptions {
  readonly signal?: AbortSignal;
}

export interface SpeechPcm {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly channels: 1;
}

export interface RecognizeSpeechRequest {
  readonly pcm: SpeechPcm;
  readonly language: 'zh' | 'en' | 'auto';
}

export type RecognizeSpeechResult =
  | { readonly status: 'recognized'; readonly transcript: string; readonly language?: 'zh' | 'en' }
  | { readonly status: 'empty' }
  | { readonly status: 'failed'; readonly failure: VoiceSpeechFailure };

export interface SpeechRecognizer {
  recognize(
    request: RecognizeSpeechRequest,
    options?: VoiceOperationOptions,
  ): Promise<RecognizeSpeechResult>;
}

/** Loads and warms up the recognizer so the first utterance carries no hidden wait. */
export interface PrepareSpeechRecognitionRequest {
  readonly language: 'zh' | 'en' | 'auto';
}

export type PrepareSpeechRecognitionResult =
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly failure: VoiceSpeechFailure };

export interface PreparableSpeechRecognizer {
  prepare(request: PrepareSpeechRecognitionRequest): Promise<PrepareSpeechRecognitionResult>;
}

/** One encoded audio chunk produced by a speech synthesizer. */
export interface SpeechAudioChunk {
  readonly bytes: Uint8Array;
  readonly format: 'mp3' | 'pcm';
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  /** Increments from 1 within one synthesis run. */
  readonly sequence: number;
  /** Marks the final chunk of the run. */
  readonly final: boolean;
}

/** Provider-neutral synthesis configuration for the v1 cloud synthesizers. */
export interface SynthesizerConfig {
  readonly provider: 'minimax';
  readonly apiKey: string;
  readonly voiceId: string;
}

export interface SynthesizeSpeechRequest {
  readonly text: string;
  readonly config: SynthesizerConfig;
}

export type SynthesizeSpeechResult =
  | { readonly status: 'ready'; readonly chunks: AsyncIterable<SpeechAudioChunk> }
  | { readonly status: 'failed'; readonly failure: VoiceSpeechFailure };

/**
 * Streams speech synthesis. Cancellation rides the AbortSignal in
 * VoiceOperationOptions; adapters hold no process resources, so there is
 * deliberately no cancel()/dispose() on this seam.
 */
export interface SpeechSynthesizer {
  synthesize(
    request: SynthesizeSpeechRequest,
    options?: VoiceOperationOptions,
  ): Promise<SynthesizeSpeechResult>;
}

export interface VoiceSpeechFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
}

/** Neutral speech-output failure codes; supplier specifics stay in messages, for logs only. */
export type VoiceTtsFailureCode =
  | 'voice_tts_unavailable'
  | 'voice_tts_key_missing'
  | 'voice_tts_request_failed'
  | 'voice_tts_cancelled'
  | 'voice_tts_http_failed'
  | 'voice_tts_auth_failed'
  | 'voice_tts_quota_exhausted'
  | 'voice_tts_rate_limited'
  | 'voice_tts_invalid_configuration'
  | 'voice_tts_synthesis_failed'
  | 'voice_tts_decode_failed';

/**
 * Carries a VoiceSpeechFailure through a mid-stream throw. The speech-output
 * runtime preserves the original failure so supplier-neutral codes reach the
 * renderer instead of a generic wrap.
 */
export class VoiceSpeechFailureError extends Error {
  readonly failure: VoiceSpeechFailure;

  constructor(failure: VoiceSpeechFailure) {
    super(failure.message);
    this.name = 'VoiceSpeechFailureError';
    this.failure = failure;
  }
}

export function isVoiceSpeechFailureError(error: unknown): error is VoiceSpeechFailureError {
  return error instanceof VoiceSpeechFailureError;
}
