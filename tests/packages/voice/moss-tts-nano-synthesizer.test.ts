import { describe, expect, it } from 'vitest';
import { createMossTtsNanoSynthesizer } from '../../../packages/voice/src';

describe('MOSS-TTS-Nano synthesizer', () => {
  it('prepares the model and selected reference audio without synthesizing dummy speech', async () => {
    const preparations: unknown[] = [];
    const synthesizer = createMossTtsNanoSynthesizer({
      modelPath: 'C:/models/moss',
      cachePath: 'C:/cache/voice',
      sidecarExecutablePath: 'C:/resources/moss-sidecar.exe',
      client: {
        async prepare(request) { preparations.push(request); },
        async *synthesize() { throw new Error('Preparation must not synthesize dummy speech.'); },
        async dispose() {},
      },
      ids: {
        createPreparationId: () => 'preparation:1',
        createSynthesisId: () => 'synthesis:1',
      },
    });

    await expect(synthesizer.prepare({
      voiceProfileId: 'voice-profile:warm',
      voice: { kind: 'reference_audio', referenceAudioPath: 'C:/profiles/warm/reference.wav' },
    })).resolves.toEqual({ status: 'ready' });
    expect(preparations).toEqual([{
      preparationId: 'preparation:1',
      modelPath: 'C:/models/moss',
      cachePath: 'C:/cache/voice',
      voice: { kind: 'reference_audio', referenceAudioPath: 'C:/profiles/warm/reference.wav' },
      signal: undefined,
    }]);
  });

  it('streams sidecar PCM chunks using the selected reference audio', async () => {
    const requests: unknown[] = [];
    const synthesizer = createMossTtsNanoSynthesizer({
      modelPath: 'C:/models/moss',
      cachePath: 'C:/cache/voice',
      sidecarExecutablePath: 'C:/resources/moss-sidecar.exe',
      client: {
        async prepare() {},
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
      voice: { kind: 'built_in', voiceId: 'Xiaoyu' },
    })) chunks.push(chunk);

    expect(requests).toEqual([{
      synthesisId: 'synthesis:1',
      modelPath: 'C:/models/moss',
      cachePath: 'C:/cache/voice',
      text: '你好，Megumi。',
      voice: { kind: 'built_in', voiceId: 'Xiaoyu' },
      signal: undefined,
    }]);
    expect(chunks.map((chunk) => chunk.final)).toEqual([false, true]);
  });

  it('resolves the active model path for each synthesis', async () => {
    let modelPath = 'C:/models/voice-v1';
    const requests: { modelPath: string }[] = [];
    const synthesizer = createMossTtsNanoSynthesizer({
      modelPath: () => modelPath,
      cachePath: 'C:/cache',
      sidecarExecutablePath: 'C:/sidecar.exe',
      client: {
        async prepare() {},
        async *synthesize(request) { requests.push({ modelPath: request.modelPath }); },
        async dispose() {},
      },
    });

    for await (const _chunk of synthesizer.synthesize({ text: 'one', voiceProfileId: 'v', voice: { kind: 'built_in', voiceId: 'Ava' } })) {}
    modelPath = 'C:/models/voice-v2';
    for await (const _chunk of synthesizer.synthesize({ text: 'two', voiceProfileId: 'v', voice: { kind: 'built_in', voiceId: 'Ava' } })) {}

    expect(requests).toEqual([{ modelPath: 'C:/models/voice-v1' }, { modelPath: 'C:/models/voice-v2' }]);
  });
});
