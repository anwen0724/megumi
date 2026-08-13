/* Public Voice package entry: stable contracts and required composition factories only. */

export * from './speech';
export { createSenseVoiceRecognizer, type CreateSenseVoiceRecognizerOptions } from './sensevoice-recognizer';
export {
  createMossTtsNanoSynthesizer,
  type CreateMossTtsNanoSynthesizerOptions,
} from './moss-tts-nano-synthesizer';
export * from './voice';
export * from './voice-models';
export * from './voice-profiles';
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
