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
});
