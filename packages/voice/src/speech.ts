/*
 * Defines the provider-neutral speech recognition seam used by the Voice
 * runtime and Desktop speech input adapter. Concrete sherpa and Electron
 * types stay internal. Speech synthesis and playback seams were removed
 * together with the MOSS TTS implementation and will be re-designed
 * separately from speech input.
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

export interface VoiceSpeechFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
}
