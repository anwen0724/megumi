import { describe, expect, it, vi } from 'vitest';
import { createSenseVoiceRecognizer } from '../../../packages/voice/src';

describe('SenseVoice recognizer', () => {
  it('uses the official offline recognizer and returns one final transcript', async () => {
    const acceptWaveform = vi.fn();
    const decode = vi.fn();
    const getResult = vi.fn(() => ({ text: ' 你好，Megumi。 ' }));
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: class {
          createStream() { return { acceptWaveform }; }
          decode = decode;
          getResult = getResult;
        },
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
    expect(acceptWaveform).toHaveBeenCalledWith({ sampleRate: 16_000, samples: pcm.samples });
    expect(decode).toHaveBeenCalledOnce();
    expect(getResult).toHaveBeenCalledOnce();
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

  it('uses the Voice Session recognition language instead of hard-coding auto', async () => {
    const configurations: any[] = [];
    const recognizer = createSenseVoiceRecognizer({
      modelPath: 'C:/models/model.int8.onnx',
      tokensPath: 'C:/models/tokens.txt',
      runtimeLoader: async () => ({
        OfflineRecognizer: class {
          constructor(configuration: Record<string, unknown>) { configurations.push(configuration); }
          createStream() { return { acceptWaveform() {} }; }
          decode() {}
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
