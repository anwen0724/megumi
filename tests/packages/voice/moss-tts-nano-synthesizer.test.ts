import { describe, expect, it } from 'vitest';
import { createMossTtsNanoSynthesizer } from '../../../packages/voice/src';

describe('MOSS-TTS-Nano synthesizer', () => {
  it('streams sidecar PCM chunks using the selected reference audio', async () => {
    const requests: unknown[] = [];
    const synthesizer = createMossTtsNanoSynthesizer({
      modelPath: 'C:/models/moss',
      cachePath: 'C:/cache/voice',
      sidecarExecutablePath: 'C:/resources/moss-sidecar.exe',
      client: {
        async *synthesize(request) {
          requests.push(request);
          yield { samples: new Float32Array([0.1]), sampleRate: 24_000, channels: 1 as const };
          yield { samples: new Float32Array([0.2]), sampleRate: 24_000, channels: 1 as const };
        },
        async dispose() {},
      },
      ids: { createSynthesisId: () => 'synthesis:1' },
    });

    const chunks = [];
    for await (const chunk of synthesizer.synthesize({
      text: '你好，Megumi。',
      voiceProfileId: 'voice-profile:warm',
      referenceAudioPath: 'C:/profiles/warm/reference.wav',
      language: 'zh',
    })) chunks.push(chunk);

    expect(requests).toEqual([{
      synthesisId: 'synthesis:1',
      modelPath: 'C:/models/moss',
      cachePath: 'C:/cache/voice',
      text: '你好，Megumi。',
      referenceAudioPath: 'C:/profiles/warm/reference.wav',
      language: 'zh',
      signal: undefined,
    }]);
    expect(chunks.map((chunk) => chunk.final)).toEqual([false, true]);
  });
});
