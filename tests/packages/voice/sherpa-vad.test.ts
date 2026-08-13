import { describe, expect, it, vi } from 'vitest';
import { createSherpaVad } from '../../../packages/voice/src';
import { SPEECH_BOUNDARY_CONFIG } from '../../../packages/voice/src/speech-input/speech-input';

describe('Sherpa VAD adapter', () => {
  it('fixes the Silero VAD parameters and per-frame classification mode', async () => {
    const configurations: { config: Record<string, unknown>; bufferSizeInSeconds: number }[] = [];
    const acceptWaveform = vi.fn();
    const isDetected = vi.fn(() => true);
    const reset = vi.fn();
    const vad = await createSherpaVad({
      modelPath: 'C:/resources/vad/silero_vad.onnx',
      runtimeLoader: async () => ({
        Vad: class {
          constructor(config: Record<string, unknown>, bufferSizeInSeconds: number) {
            configurations.push({ config, bufferSizeInSeconds });
          }
          acceptWaveform = acceptWaveform;
          isDetected = isDetected;
          reset = reset;
        },
      }),
    });

    expect(configurations).toHaveLength(1);
    expect(configurations[0]!.config).toEqual({
      sileroVad: {
        model: 'C:/resources/vad/silero_vad.onnx',
        threshold: 0.5,
        minSilenceDuration: 0,
        minSpeechDuration: 0,
        windowSize: 512,
        maxSpeechDuration: 60,
      },
      sampleRate: 16_000,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    });
    expect(configurations[0]!.bufferSizeInSeconds).toBe(60);

    const samples = new Float32Array(512).fill(0.1);
    vad.accept(samples);
    expect(acceptWaveform).toHaveBeenCalledWith(samples);
    expect(vad.isSpeech()).toBe(true);
    vad.reset();
    expect(reset).toHaveBeenCalledOnce();
  });

  it('uses the fixed boundary parameters from the shared config', () => {
    expect(SPEECH_BOUNDARY_CONFIG).toEqual({
      sampleRate: 16_000,
      windowSamples: 512,
      threshold: 0.5,
      preRollMs: 1000,
      minSpeechMs: 250,
      endSilenceMs: 600,
      maxUtteranceMs: 60_000,
    });
  });

  it('rejects frames that are not exactly one 512-sample window', async () => {
    const vad = await createSherpaVad({
      modelPath: 'C:/resources/vad/silero_vad.onnx',
      runtimeLoader: async () => ({
        Vad: class {
          acceptWaveform() {}
          isDetected() { return false; }
          reset() {}
        },
      }),
    });

    expect(() => vad.accept(new Float32Array(256))).toThrow();
    expect(() => vad.accept(new Float32Array(1024))).toThrow();
  });

  it('maps runtime loading failures to a stable VAD initialization failure', async () => {
    await expect(createSherpaVad({
      modelPath: 'C:/missing/silero_vad.onnx',
      runtimeLoader: async () => {
        throw new Error('Failed to load sherpa-onnx native module.');
      },
    })).rejects.toMatchObject({
      code: 'vad_initialization_failed',
    });
  });

  it('maps VAD construction failures to a stable VAD initialization failure', async () => {
    await expect(createSherpaVad({
      modelPath: 'C:/missing/silero_vad.onnx',
      runtimeLoader: async () => ({
        Vad: class {
          constructor() {
            throw new Error('Could not create the VAD with the given model.');
          }
        },
      }),
    })).rejects.toMatchObject({
      code: 'vad_initialization_failed',
    });
  });
});
