/*
 * Host-neutral adapter over the sherpa-onnx VAD. Fixes the Silero parameters
 * and exposes a per-frame speech classifier; all boundary rules live in the
 * Utterance Recorder. Loads the native runtime lazily so the Voice package
 * stays testable without native modules.
 */

import {
  SPEECH_BOUNDARY_CONFIG,
} from './speech-input';
import type { VoiceSpeechFailure } from '../speech';

/** Per-frame speech classifier fed with 512-sample 16 kHz mono frames. */
export interface SpeechVad {
  accept(samples: Float32Array): void;
  isSpeech(): boolean;
  reset(): void;
}

interface SherpaVadInstance {
  acceptWaveform(samples: Float32Array): void;
  isDetected(): boolean;
  reset(): void;
}

export interface SherpaVadRuntime {
  readonly Vad: new (config: Record<string, unknown>, bufferSizeInSeconds: number) => SherpaVadInstance;
}

export interface CreateSherpaVadOptions {
  readonly modelPath: string;
  /** @internal Test seam; production loads sherpa-onnx-node. */
  readonly runtimeLoader?: () => Promise<SherpaVadRuntime>;
}

/**
 * Creates the VAD; rejects with a stable failure when the native runtime or
 * the Silero model cannot load. The runtime treats that as a manual-boundary
 * fallback, never as a microphone failure.
 */
export async function createSherpaVad(options: CreateSherpaVadOptions): Promise<SpeechVad> {
  try {
    const runtime = await (options.runtimeLoader ?? loadSherpaRuntime)();
    const vad = new runtime.Vad({
      sileroVad: {
        model: options.modelPath,
        threshold: SPEECH_BOUNDARY_CONFIG.threshold,
        // Per-frame classification: min speech/silence debouncing belongs to
        // the Utterance Recorder, not to the detector.
        minSilenceDuration: 0,
        minSpeechDuration: 0,
        windowSize: SPEECH_BOUNDARY_CONFIG.windowSamples,
        maxSpeechDuration: SPEECH_BOUNDARY_CONFIG.maxUtteranceMs / 1000,
      },
      sampleRate: SPEECH_BOUNDARY_CONFIG.sampleRate,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    }, SPEECH_BOUNDARY_CONFIG.maxUtteranceMs / 1000);
    return {
      accept(samples) {
        if (samples.length !== SPEECH_BOUNDARY_CONFIG.windowSamples) {
          throw new Error(`Speech VAD expects ${SPEECH_BOUNDARY_CONFIG.windowSamples} samples per frame, received ${samples.length}.`);
        }
        vad.acceptWaveform(samples);
      },
      isSpeech: () => vad.isDetected(),
      reset: () => vad.reset(),
    };
  } catch (error) {
    const failure: VoiceSpeechFailure = {
      code: 'vad_initialization_failed',
      message: error instanceof Error ? error.message : String(error),
    };
    throw failure;
  }
}

async function loadSherpaRuntime(): Promise<SherpaVadRuntime> {
  const loaded = await import('sherpa-onnx-node') as unknown as SherpaVadRuntime & { default?: SherpaVadRuntime };
  return loaded.Vad ? loaded : loaded.default as SherpaVadRuntime;
}
