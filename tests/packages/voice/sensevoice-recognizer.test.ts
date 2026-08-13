import { describe, expect, it, vi } from 'vitest';
import { createSenseVoiceRecognizer } from '../../../packages/voice/src';

interface FakeRecognizerInput {
  readonly result?: { readonly text?: string };
  readonly delayMs?: number;
  readonly configurations?: Record<string, unknown>[];
}

function fakeRuntime(input: FakeRecognizerInput = {}) {
  const streams: Array<{ acceptWaveform: ReturnType<typeof vi.fn> }> = [];
  const decode = vi.fn();
  const getResult = vi.fn(() => ({ text: 'unused' }));
  const decodeAsync = vi.fn(async (stream: unknown) => {
    if (input.delayMs) await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    expect(streams.some((candidate) => candidate === stream)).toBe(true);
    return input.result ?? { text: ' hello ' };
  });
  const OfflineRecognizer = class {
    constructor(configuration: Record<string, unknown>) { input.configurations?.push(configuration); }
    createStream() {
      const acceptWaveform = vi.fn();
      const stream = { acceptWaveform };
      streams.push(stream);
      return stream;
    }
    decode(stream: unknown) { decode(stream); }
    decodeAsync(stream: unknown) { return decodeAsync(stream); }
    getResult(stream: unknown) { return getResult(stream); }
  };
  return { streams, decode, decodeAsync, getResult, OfflineRecognizer };
}

describe('SenseVoice recognizer', () => {
  it('uses decodeAsync, a fresh stream per utterance, and 16 kHz Float32 input directly', async () => {
    const fake = fakeRuntime({ result: { text: ' 你好，Megumi。 ' } });
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: fake.OfflineRecognizer,
      }),
    });
    const pcm = {
      samples: new Float32Array([0.1, -0.1]),
      sampleRate: 16_000,
      channels: 1 as const,
    };

    await expect(recognizer.recognize({ pcm, language: 'auto' })).resolves.toEqual({
      status: 'recognized',
      transcript: '你好，Megumi。',
    });
    await recognizer.recognize({ pcm, language: 'auto' });

    expect(fake.streams).toHaveLength(2);
    for (const stream of fake.streams) {
      expect(stream.acceptWaveform).toHaveBeenCalledWith({ sampleRate: 16_000, samples: pcm.samples });
    }
    expect(fake.decodeAsync).toHaveBeenCalledTimes(2);
    expect(fake.decode).not.toHaveBeenCalled();
    expect(fake.getResult).not.toHaveBeenCalled();
  });

  it('strips SenseVoice control marks and reports the detected language', async () => {
    const fake = fakeRuntime();
    fake.decodeAsync
      .mockResolvedValueOnce({ text: '<|zh|><|NEUTRAL|><|Speech|><|woitn|> 你好，Megumi。 <|withitn|>' })
      .mockResolvedValueOnce({ text: '<|en|><|NEUTRAL|> Nice to meet you.' });
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: fake.OfflineRecognizer,
      }),
    });
    const pcm = { samples: new Float32Array([0.1]), sampleRate: 16_000, channels: 1 as const };

    await expect(recognizer.recognize({ pcm, language: 'auto' })).resolves.toEqual({
      status: 'recognized',
      transcript: '你好，Megumi。',
      language: 'zh',
    });
    await expect(recognizer.recognize({ pcm, language: 'auto' })).resolves.toEqual({
      status: 'recognized',
      transcript: 'Nice to meet you.',
      language: 'en',
    });
  });

  it('returns empty when the decoder produces no readable text', async () => {
    const fake = fakeRuntime({ result: { text: '' } });
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: fake.OfflineRecognizer,
      }),
    });
    const pcm = { samples: new Float32Array([0.1]), sampleRate: 16_000, channels: 1 as const };

    await expect(recognizer.recognize({ pcm, language: 'auto' })).resolves.toEqual({ status: 'empty' });
  });

  it('honours cancellation without waiting for the decoder', async () => {
    const fake = fakeRuntime({ result: { text: 'late' }, delayMs: 50 });
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: fake.OfflineRecognizer,
      }),
    });
    const controller = new AbortController();
    controller.abort();
    const pcm = { samples: new Float32Array([0.1]), sampleRate: 16_000, channels: 1 as const };

    const result = await recognizer.recognize({ pcm, language: 'auto' }, { signal: controller.signal });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'voice_recognition_cancelled' },
    });
    expect(fake.decodeAsync).not.toHaveBeenCalled();
  });

  it('maps decoder failures to a stable recognition failure', async () => {
    const decodeAsync = vi.fn(async () => {
      throw new Error('Decoder crashed.');
    });
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: class {
          createStream() { return { acceptWaveform() {} }; }
          decodeAsync = decodeAsync;
          decode() {}
          getResult() { return {}; }
        },
      }),
    });
    const pcm = { samples: new Float32Array([0.1]), sampleRate: 16_000, channels: 1 as const };

    await expect(recognizer.recognize({ pcm, language: 'auto' })).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'sensevoice_recognition_failed' },
    });
  });

  it('rebuilds the recognizer when the active model bundle changes', async () => {
    let root = 'C:/models/voice-v1';
    const configurations: Record<string, unknown>[] = [];
    const recognizer = createSenseVoiceRecognizer({
      modelPath: () => `${root}/model.int8.onnx`,
      tokensPath: () => `${root}/tokens.txt`,
      runtimeLoader: async () => ({
        OfflineRecognizer: class {
          constructor(configuration: Record<string, unknown>) { configurations.push(configuration); }
          createStream() { return { acceptWaveform() {} }; }
          decode() {}
          async decodeAsync() { return { text: 'ok' }; }
          getResult() { return { text: 'ok' }; }
        },
      }),
    });
    const request = { pcm: { samples: new Float32Array(), sampleRate: 16_000, channels: 1 as const }, language: 'auto' as const };

    await recognizer.recognize(request);
    root = 'C:/models/voice-v2';
    await recognizer.recognize(request);

    expect(configurations).toHaveLength(2);
  });

  it('uses the requested recognition language instead of hard-coding auto', async () => {
    const configurations: any[] = [];
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: class {
          constructor(configuration: Record<string, unknown>) { configurations.push(configuration); }
          createStream() { return { acceptWaveform() {} }; }
          decode() {}
          async decodeAsync() { return { text: 'ok' }; }
          getResult() { return { text: 'ok' }; }
        },
      }),
    });
    const pcm = { samples: new Float32Array(), sampleRate: 16_000, channels: 1 as const };

    await recognizer.recognize({ pcm, language: 'zh' });
    await recognizer.recognize({ pcm, language: 'en' });

    expect(configurations.map((configuration) => configuration.modelConfig.senseVoice.language)).toEqual(['zh', 'en']);
  });
});

describe('SenseVoice recognizer preparation', () => {
  it('initializes the recognizer once across prepare, warm-up, and the first utterance', async () => {
    const configurations: Record<string, unknown>[] = [];
    const decodeAsync = vi.fn(async () => ({ text: 'hello' }));
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: class {
          constructor(configuration: Record<string, unknown>) { configurations.push(configuration); }
          createStream() { return { acceptWaveform: vi.fn() }; }
          decode() {}
          decodeAsync = decodeAsync;
          getResult() { return { text: 'hello' }; }
        },
      }),
    });

    await expect(recognizer.prepare({ language: 'auto' })).resolves.toEqual({ status: 'ready' });
    // The warm-up ran one decode of 100 ms silence through the same instance.
    expect(decodeAsync).toHaveBeenCalledTimes(1);
    expect(configurations).toHaveLength(1);

    // The first real utterance reuses the prepared instance.
    const pcm = { samples: new Float32Array([0.1]), sampleRate: 16_000, channels: 1 as const };
    await expect(recognizer.recognize({ pcm, language: 'auto' })).resolves.toMatchObject({ status: 'recognized' });
    expect(configurations).toHaveLength(1);
  });

  it('returns a structured failure when preparation cannot load the model and retries afterwards', async () => {
    let attempts = 0;
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: class {
          constructor() {
            attempts += 1;
            if (attempts === 1) throw new Error('Model file missing.');
          }
          createStream() { return { acceptWaveform() {} }; }
          decode() {}
          decodeAsync = vi.fn(async () => ({ text: 'ok' }));
          getResult() { return { text: 'ok' }; }
        },
      }),
    });

    await expect(recognizer.prepare({ language: 'auto' })).resolves.toEqual({
      status: 'failed',
      failure: expect.objectContaining({ code: 'sensevoice_preparation_failed' }),
    });
    // A restart path (fresh prepare) retries the load instead of reusing a
    // poisoned cache entry.
    await expect(recognizer.prepare({ language: 'auto' })).resolves.toEqual({ status: 'ready' });
    expect(attempts).toBe(2);
  });

  it('re-checks cancellation after decodeAsync settles and never returns stale text', async () => {
    const decodeAsync = vi.fn(async () => {
      controller.abort();
      return { text: 'late text' };
    });
    const controller = new AbortController();
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: class {
          createStream() { return { acceptWaveform() {} }; }
          decode() {}
          decodeAsync = decodeAsync;
          getResult() { return {}; }
        },
      }),
    });
    const pcm = { samples: new Float32Array([0.1]), sampleRate: 16_000, channels: 1 as const };

    await expect(recognizer.recognize({ pcm, language: 'auto' }, { signal: controller.signal }))
      .resolves.toEqual({
        status: 'failed',
        failure: { code: 'voice_recognition_cancelled', message: 'Speech recognition was cancelled.' },
      });
  });
});
