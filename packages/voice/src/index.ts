/* Public Voice package entry: stable contracts and required composition factories only. */

export * from './speech';
export { createSenseVoiceRecognizer, type CreateSenseVoiceRecognizerOptions } from './sensevoice-recognizer';
export * from './voice';
export * from './voice-models';
export * from './voice-session';
export * from './speech-input/speech-input';
export {
  SpeechInputEventSchema,
  FinalTranscriptSchema,
  parseSpeechInputEvent,
  type ParsedFinalTranscript,
} from './speech-input/speech-input-schema';
export {
  createSpeechInputRuntime,
  type CreateSpeechInputRuntimeOptions,
  type SpeechInputRuntimeInternal,
} from './speech-input/speech-input-runtime';
export {
  createSherpaVad,
  type SpeechVad,
  type CreateSherpaVadOptions,
} from './speech-input/sherpa-vad';
export {
  createSpeechOutputRuntime,
  type ReadSpeechOutputRequest,
  type SpeechOutputEvent,
  type SpeechOutputEventListener,
  type SpeechOutputRuntime,
  type SpeechOutputStopReason,
  type SpeechOutputSubscription,
} from './speech-output/speech-output-runtime';
export {
  SpeechOutputEventSchema,
  parseSpeechOutputEvent,
} from './speech-output/speech-output-schema';
export { filterReplyTextForSpeech } from './speech-output/reply-text-filter';
export {
  createMinimaxSynthesizer,
  type CreateMinimaxSynthesizerOptions,
} from './speech-output/synthesizers/minimax-synthesizer';
