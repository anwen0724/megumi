/*
 * Defines provider-neutral speech seams used by the Voice runtime and Desktop
 * playback adapter. Concrete sherpa, MOSS, and Electron types stay internal.
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

export interface SynthesizeSpeechRequest {
  readonly text: string;
  readonly voiceProfileId: string;
  readonly voice: SpeechVoiceSource;
}

export interface PrepareSpeechRequest {
  readonly voiceProfileId: string;
  readonly voice: SpeechVoiceSource;
}

export type SpeechVoiceSource =
  | { readonly kind: 'built_in'; readonly voiceId: string }
  | { readonly kind: 'reference_audio'; readonly referenceAudioPath: string };

export type PrepareSpeechResult =
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly failure: VoiceSpeechFailure };

export interface SynthesizedAudioChunk {
  readonly pcm: SpeechPcm;
  readonly final: boolean;
}

export interface SpeechSynthesizer {
  prepare(
    request: PrepareSpeechRequest,
    options?: VoiceOperationOptions,
  ): Promise<PrepareSpeechResult>;
  synthesize(
    request: SynthesizeSpeechRequest,
    options?: VoiceOperationOptions,
  ): AsyncIterable<SynthesizedAudioChunk>;
}

export interface PlaySpeechRequest {
  readonly segmentId: string;
  readonly audio: AsyncIterable<SynthesizedAudioChunk>;
}

export type PlaySpeechResult =
  | { readonly status: 'played' }
  | { readonly status: 'stopped' }
  | { readonly status: 'failed'; readonly failure: VoiceSpeechFailure };

export interface StopSpeechRequest {
  readonly reason: 'interrupted' | 'session_ended' | 'segment_invalidated' | 'disposed';
}

export interface SpeechPlayer {
  play(request: PlaySpeechRequest, options?: VoiceOperationOptions): Promise<PlaySpeechResult>;
  stop(request: StopSpeechRequest): Promise<void>;
}

export interface VoiceSpeechFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
}
