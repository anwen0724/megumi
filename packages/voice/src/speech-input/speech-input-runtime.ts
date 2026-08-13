/*
 * Coordinates the VAD, the Utterance Recorder, and SenseVoice into the single
 * Speech Input Runtime. Owns the state machine, event projection, cancellation,
 * and generation invalidation rules; runs wherever the host places it.
 */

import type { SpeechRecognizer } from '../speech';
import {
  SPEECH_BOUNDARY_CONFIG,
  type SpeechBoundaryConfig,
  type SpeechInputEvent,
  type SpeechInputFrame,
  type SpeechInputGenerationRequest,
  type SpeechInputRuntime,
  type SpeechInputRuntimeStatus,
  type SetSpeechInputMutedRequest,
  type StartSpeechInputRequest,
  type StartSpeechInputResult,
  type StopSpeechInputRequest,
} from './speech-input';
import {
  createUtteranceRecorder,
  type UtteranceRecorder,
} from './utterance-recorder';
import type { SpeechVad } from './sherpa-vad';

export interface CreateSpeechInputRuntimeOptions {
  readonly boundary?: SpeechBoundaryConfig;
  /** Loads the VAD; when absent or failing, the runtime stays in manual mode. */
  readonly vad?: () => Promise<SpeechVad>;
  readonly recognizer: SpeechRecognizer;
  readonly ids: { readonly createUtteranceId: () => string };
  readonly now?: () => number;
}

/** Host-internal handles for overflow resets; not part of the public contract. */
export interface SpeechInputRuntimeInternal {
  handleOverflow(): void;
  getStatus(): SpeechInputRuntimeStatus;
  dispose(): void;
}

export function createSpeechInputRuntime(
  options: CreateSpeechInputRuntimeOptions,
): SpeechInputRuntime & SpeechInputRuntimeInternal {
  const listeners = new Set<(event: SpeechInputEvent) => void>();
  let generation = 0;
  let status: SpeechInputRuntimeStatus = 'stopped';
  let mode: 'automatic' | 'manual' = 'automatic';
  let muted = false;
  let recognizing = false;
  let recognitionAbort: AbortController | undefined;
  let recognitionGeneration = 0;
  let vad: SpeechVad | undefined;
  let language: 'zh' | 'en' | 'auto' = 'auto';
  let nextGeneration = 0;
  let expectedSequence: number | undefined;
  const recorder: UtteranceRecorder = createUtteranceRecorder({
    boundary: options.boundary ?? SPEECH_BOUNDARY_CONFIG,
    now: options.now,
  });

  const emit = (event: SpeechInputEvent) => {
    for (const listener of listeners) listener(event);
  };

  const resumeListening = () => {
    if (mode === 'automatic') {
      status = 'listening';
      emit({ type: 'listening', generation });
    } else {
      status = 'automatic-boundary-unavailable';
    }
  };

  const resetRecorder = () => {
    recorder.reset(generation);
    vad?.reset();
  };

  const degradeToManual = () => {
    // VAD-09: a VAD failure only degrades to manual boundaries; the microphone
    // and STT keep working.
    mode = 'manual';
    resetRecorder();
    status = 'automatic-boundary-unavailable';
    emit({ type: 'automatic-boundary-unavailable', generation });
  };

  const handleRecorderResult = (result: ReturnType<UtteranceRecorder['accept']>) => {
    if (result.type === 'complete') {
      void recognize(result.utterance);
    } else if (result.type === 'empty') {
      emit({ type: 'empty-utterance', generation, source: 'boundary' });
      resumeListening();
    } else if (result.type === 'invalid') {
      // A sequence gap means frames were dropped; the utterance is discarded
      // and the host is told audio processing fell behind.
      emit({ type: 'audio-overflow', generation });
      resetRecorder();
      resumeListening();
    }
  };

  const isValidFrame = (frame: SpeechInputFrame): boolean =>
    frame.sampleRate === 16_000
    && frame.samples.length === SPEECH_BOUNDARY_CONFIG.windowSamples
    && !frame.samples.some((sample) => !Number.isFinite(sample));

  /** Reads the live status; callbacks may change it while a recognition awaits. */
  const hasStopped = (): boolean => status === 'stopped';

  const handleOverflow = () => {
    if (status === 'stopped') return;
    if (recognizing) {
      // Recognition already has its complete utterance; only the next
      // utterance's pre-roll is cleared.
      resetRecorder();
      expectedSequence = undefined;
      return;
    }
    recorder.overflow();
    vad?.reset();
    expectedSequence = undefined;
    emit({ type: 'audio-overflow', generation });
    resumeListening();
  };

  const recognize = async (utterance: {
    readonly generation: number;
    readonly samples: Float32Array;
    readonly startedAt: number;
    readonly endedAt: number;
  }) => {
    recognizing = true;
    recognitionGeneration = generation;
    recognitionAbort = new AbortController();
    status = 'recognizing';
    emit({ type: 'recognizing', generation });
    const result = await options.recognizer.recognize({
      pcm: { samples: utterance.samples, sampleRate: 16_000, channels: 1 },
      language,
    }, { signal: recognitionAbort.signal });
    // A cancelled recognition from stop or a generation change must not leak
    // into the current run.
    if (recognitionGeneration !== generation || hasStopped()) return;
    recognizing = false;
    recognitionAbort = undefined;
    if (result.status === 'recognized') {
      emit({
        type: 'final-transcript',
        generation,
        transcript: {
          generation,
          utteranceId: options.ids.createUtteranceId(),
          text: result.transcript,
          ...(result.language ? { language: result.language } : {}),
          startedAt: utterance.startedAt,
          endedAt: utterance.endedAt,
        },
      });
    } else if (result.status === 'empty') {
      emit({ type: 'empty-utterance', generation, source: 'recognition' });
    } else {
      emit({ type: 'recognition-failed', generation, failure: result.failure });
    }
    resumeListening();
  };

  return {
    async start(request) {
      if (status !== 'stopped') {
        if (request.generation === undefined || request.generation === generation) {
          return { status: 'started', generation };
        }
        // Restarting with a new generation ends the previous run first.
        recognitionAbort?.abort();
        emit({ type: 'stopped', generation });
      }
      generation = request.generation ?? ++nextGeneration;
      language = request.language ?? 'auto';
      muted = false;
      recognizing = false;
      mode = 'automatic';
      resetRecorder();
      expectedSequence = undefined;
      status = 'starting';
      emit({ type: 'runtime-ready', generation });
      try {
        vad = options.vad ? await options.vad() : undefined;
      } catch {
        vad = undefined;
      }
      if (!vad) {
        degradeToManual();
      } else {
        resumeListening();
      }
      return { status: 'started', generation };
    },
    acceptFrame(frame) {
      if (status === 'stopped' || muted || recognizing) return;
      if (frame.generation !== generation) return;
      if (!isValidFrame(frame)) return;
      // Track sequence continuity across the whole run: a jump means frames
      // were dropped by the host queue, which fails the current utterance
      // even while the pre-roll is still accumulating.
      if (expectedSequence !== undefined && frame.sequence > expectedSequence + 1) {
        handleOverflow();
        expectedSequence = frame.sequence;
      } else if (expectedSequence === undefined || frame.sequence === expectedSequence + 1) {
        expectedSequence = frame.sequence;
      } else {
        return; // duplicate or stale sequence
      }
      if (mode === 'automatic' && vad) {
        let speech: boolean;
        try {
          vad.accept(frame.samples);
          speech = vad.isSpeech();
        } catch {
          degradeToManual();
          return;
        }
        if (speech && status === 'listening') {
          status = 'speech-detected';
          emit({ type: 'speech-started', generation });
        }
        const result = recorder.accept(frame, speech);
        if (result.type === 'complete') {
          status = 'speech-detected';
          emit({ type: 'speech-ended', generation });
        }
        handleRecorderResult(result);
        return;
      }
      // Manual mode: frames only matter between the two boundary clicks.
      handleRecorderResult(recorder.accept(frame, false));
    },
    setMuted(request: SetSpeechInputMutedRequest) {
      if (status === 'stopped') return;
      muted = request.muted;
      if (muted) {
        // Drop the in-progress utterance and pre-roll; the host also stops
        // delivering frames while muted.
        recognizing = false;
        recognitionAbort?.abort();
        recognitionAbort = undefined;
        resetRecorder();
        expectedSequence = undefined;
      }
    },
    startManualUtterance(request: SpeechInputGenerationRequest) {
      if (status === 'stopped' || recognizing || request.generation !== generation) return;
      recorder.beginManual();
      emit({ type: 'speech-started', generation });
      status = 'speech-detected';
    },
    finishManualUtterance(request: SpeechInputGenerationRequest) {
      if (status === 'stopped' || recognizing || request.generation !== generation) return;
      emit({ type: 'speech-ended', generation });
      const result = recorder.finishManual();
      if (result.type === 'complete') {
        void recognize(result.utterance);
      } else if (result.type === 'empty') {
        emit({ type: 'empty-utterance', generation, source: 'boundary' });
        resumeListening();
      }
    },
    async stop(request: StopSpeechInputRequest) {
      if (status === 'stopped') return;
      if (request.generation !== undefined && request.generation !== generation) return;
      recognitionAbort?.abort();
      recognitionAbort = undefined;
      recognizing = false;
      muted = false;
      status = 'stopped';
      resetRecorder();
      emit({ type: 'stopped', generation });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    handleOverflow,
    getStatus: () => status,
    dispose() {
      recognitionAbort?.abort();
      recognitionAbort = undefined;
      recognizing = false;
      status = 'stopped';
      recorder.reset(generation);
      listeners.clear();
    },
  };
}
