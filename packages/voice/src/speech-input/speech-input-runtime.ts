/*
 * Coordinates the VAD, the Utterance Recorder, and SenseVoice into the single
 * Speech Input Runtime. Owns the state machine, event projection, cancellation,
 * and generation invalidation rules; runs wherever the host places it.
 *
 * Event order at start: the runtime resolves the VAD initialization FIRST and
 * only then emits runtime-ready, followed by listening (automatic) or
 * automatic-boundary-unavailable (manual fallback). STT preparation follows on
 * its own lane with stt-preparing / stt-ready / stt-failed so the first
 * utterance never silently carries the model load.
 *
 * Recognition cancellation is token-based: mute, stop, restart, and dispose
 * invalidate the current operation token; a decode that settles later is
 * discarded without emitting final-transcript, empty-utterance, or
 * recognition-failed. New recognition never overlaps a settling decode.
 */

import type {
  PrepareSpeechRecognitionResult,
  PreparableSpeechRecognizer,
  SpeechRecognizer,
} from '../speech';
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
  const preparableRecognizer: PreparableSpeechRecognizer | undefined =
    typeof (options.recognizer as unknown as Partial<PreparableSpeechRecognizer>).prepare === 'function'
      ? options.recognizer as unknown as PreparableSpeechRecognizer
      : undefined;
  let generation = 0;
  let status: SpeechInputRuntimeStatus = 'stopped';
  let mode: 'automatic' | 'manual' = 'automatic';
  let muted = false;
  let recognizing = false;
  let activeRecognitions = 0;
  let recognitionToken = 0;
  let recognitionAbort: AbortController | undefined;
  let recognizerPreparation: Promise<PrepareSpeechRecognitionResult> | undefined;
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

  const prepareRecognizer = (): Promise<PrepareSpeechRecognitionResult> | undefined => {
    if (!preparableRecognizer || status === 'stopped') return undefined;
    const prepareGeneration = generation;
    emit({ type: 'stt-preparing', generation });
    const preparation = Promise.resolve()
      .then(() => preparableRecognizer.prepare({ language }))
      .catch((error: unknown): PrepareSpeechRecognitionResult => ({
        status: 'failed',
        failure: {
          code: 'sensevoice_preparation_failed',
          message: error instanceof Error ? error.message : 'Speech recognition preparation failed.',
        },
      }));
    recognizerPreparation = preparation;
    void preparation.then((result) => {
      // Late preparations of older runs are silent.
      if (hasStopped() || prepareGeneration !== generation) return;
      if (result.status === 'ready') {
        emit({ type: 'stt-ready', generation });
      } else {
        emit({ type: 'stt-failed', generation, failure: result.failure });
      }
    });
    return preparation;
  };

  const recognize = async (utterance: {
    readonly generation: number;
    readonly samples: Float32Array;
    readonly startedAt: number;
    readonly endedAt: number;
  }) => {
    // Each recognition owns its operation token; later decode settlements for
    // invalidated tokens are discarded entirely.
    const token = ++recognitionToken;
    recognizing = true;
    activeRecognitions += 1;
    const operationAbort = new AbortController();
    recognitionAbort = operationAbort;
    status = 'recognizing';
    emit({ type: 'recognizing', generation });
    let result: Awaited<ReturnType<SpeechRecognizer['recognize']>>;
    try {
      const preparation = recognizerPreparation;
      const preparationResult = preparation ? await preparation : undefined;
      if (operationAbort.signal.aborted || token !== recognitionToken || hasStopped()) {
        result = cancelledRecognition();
      } else if (preparationResult?.status === 'failed') {
        result = preparationResult;
      } else {
        result = await options.recognizer.recognize({
          pcm: { samples: utterance.samples, sampleRate: 16_000, channels: 1 },
          language,
        }, { signal: operationAbort.signal });
      }
    } catch (error: unknown) {
      result = operationAbort.signal.aborted
        ? cancelledRecognition()
        : {
            status: 'failed',
            failure: {
              code: 'voice_recognition_failed',
              message: error instanceof Error ? error.message : 'Speech recognition failed.',
            },
          };
    } finally {
      activeRecognitions -= 1;
      if (activeRecognitions === 0) {
        recognizing = false;
        recognitionAbort = undefined;
      }
    }
    // A cancelled or superseded recognition must not leak any result event,
    // but it still ends the recognition phase: return to listening so a new
    // utterance can start.
    if (token !== recognitionToken || hasStopped()) {
      if (!hasStopped() && status === 'recognizing') resumeListening();
      return;
    }
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
    } else if (result.failure.code !== 'voice_recognition_cancelled') {
      emit({ type: 'recognition-failed', generation, failure: result.failure });
    }
    resumeListening();
  };

  /** Invalidates every outstanding recognition; used by mute/stop/restart/dispose. */
  const invalidateRecognitions = () => {
    recognitionToken += 1;
    recognitionAbort?.abort();
    recognitionAbort = undefined;
  };

  return {
    async start(request) {
      if (status !== 'stopped') {
        if (request.generation === undefined || request.generation === generation) {
          return { status: 'started', generation };
        }
        // Restarting with a new generation ends the previous run first.
        invalidateRecognitions();
        emit({ type: 'stopped', generation });
      }
      generation = request.generation ?? ++nextGeneration;
      language = request.language ?? 'auto';
      recognizerPreparation = undefined;
      muted = false;
      recognizing = false;
      mode = 'automatic';
      resetRecorder();
      expectedSequence = undefined;
      status = 'starting';
      // The VAD decision is part of the start contract: runtime-ready is only
      // emitted once the runtime knows whether automatic boundaries exist, so
      // listeners never miss a fast automatic-boundary-unavailable.
      try {
        vad = options.vad ? await options.vad() : undefined;
      } catch {
        vad = undefined;
      }
      emit({ type: 'runtime-ready', generation });
      if (!vad) {
        degradeToManual();
      } else {
        resumeListening();
      }
      prepareRecognizer();
      return { status: 'started', generation };
    },
    acceptFrame(frame) {
      if (status === 'stopped' || status === 'starting') return;
      if (frame.generation !== generation) return;
      if (!isValidFrame(frame)) return;
      if (muted) return;
      if (recognizing) {
        // Frames ignored while a recognition drains are deliberate drops, not
        // transport losses: advance the expected sequence so the first frame
        // after recognition is never mistaken for an overflow gap.
        if (expectedSequence === undefined || frame.sequence > expectedSequence) {
          expectedSequence = frame.sequence;
        }
        return;
      }
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
        // delivering frames while muted. Outstanding recognitions are
        // invalidated so their late results never surface.
        invalidateRecognitions();
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
      invalidateRecognitions();
      recognizing = false;
      muted = false;
      status = 'stopped';
      recognizerPreparation = undefined;
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
      invalidateRecognitions();
      recognizing = false;
      status = 'stopped';
      recognizerPreparation = undefined;
      recorder.reset(generation);
      listeners.clear();
    },
  };
}

function cancelledRecognition(): Awaited<ReturnType<SpeechRecognizer['recognize']>> {
  return {
    status: 'failed',
    failure: { code: 'voice_recognition_cancelled', message: 'Speech recognition was cancelled.' },
  };
}
