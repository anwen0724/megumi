import { describe, expect, it, vi } from 'vitest';
import { createVoice, type SpeechPlayer, type SpeechRecognizer, type SpeechSynthesizer } from '../../../packages/voice/src';
import { createVoiceOperations } from '../../../packages/product/src/operations/voice-operations';

describe('Product Voice operations', () => {
  it('coordinates host audio selection without exposing local paths in Host results', async () => {
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      ids: { createVoiceProfileId: () => 'voice-profile:imported' },
    });
    const host = createVoiceOperations({
      voice,
      profileAudioPicker: {
        async chooseReferenceAudio() {
          return { status: 'selected', sourceAudioPath: 'C:/private/voice.wav' };
        },
      },
    });

    expect(await host.importProfile({ name: 'Warm voice' })).toEqual({ status: 'ok' });
    expect(await host.listProfiles()).toEqual({
      status: 'ok',
      profiles: [
        { profileId: 'voice-profile:default', name: 'Default', builtIn: true, source: 'built_in', selected: true },
        { profileId: 'voice-profile:imported', name: 'Warm voice', builtIn: false, source: 'custom', selected: false },
      ],
    });
  });

  it('exposes truthful aggregate Voice model status and update discovery', async () => {
    const checkForUpdates = vi.fn(async () => ({ status: 'checked' as const, bundleVersion: 'voice-v2' }));
    const voice = createVoice({
      defaultProfile: { profileId: 'default', name: 'Default', source: { kind: 'built_in', voiceId: 'Xiaoyu' } },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      models: {
        getStatus: () => ({
          status: 'preparing' as const,
          phase: 'downloading' as const,
          bundleVersion: 'voice-v2',
          downloadedBytes: 25,
          totalBytes: 100,
          progress: 0.25,
          bytesPerSecond: 10,
        }),
        checkForUpdates,
        async prepare() { return { status: 'ready' as const }; },
        async cancelPreparation() { return { status: 'idle' as const }; },
        getModelPath() { return 'models'; },
      },
    });
    const host = createVoiceOperations({
      voice,
      profileAudioPicker: { async chooseReferenceAudio() { return { status: 'cancelled' }; } },
    });

    expect(await host.getModelStatus()).toEqual({
      status: 'preparing',
      phase: 'downloading',
      bundleVersion: 'voice-v2',
      downloadedBytes: 25,
      totalBytes: 100,
      progress: 0.25,
      bytesPerSecond: 10,
    });
    expect(await host.checkModelUpdates()).toEqual({ status: 'checked', bundleVersion: 'voice-v2' });
  });

  it('returns a playable built-in voice preview without exposing model or reference paths', async () => {
    const voice = createVoice({
      defaultProfile: {
        profileId: 'default',
        name: '小宇',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
        language: 'zh',
        gender: 'female',
      },
      recognizer: unusedRecognizer,
      synthesizer: {
        async prepare() { return { status: 'ready' }; },
        async *synthesize(request) {
          expect(request.voice).toEqual({ kind: 'built_in', voiceId: 'Xiaoyu' });
          expect(request.text).toContain('你好');
          yield { pcm: { samples: new Float32Array([0.1, 0.2]), sampleRate: 24_000, channels: 1 }, final: true };
        },
      },
      player: unusedPlayer,
    });
    const host = createVoiceOperations({
      voice,
      profileAudioPicker: { async chooseReferenceAudio() { return { status: 'cancelled' }; } },
    });

    const result = await host.previewProfile({ profileId: 'default' });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('Expected preview audio.');
    const samples = new Float32Array(result.chunks[0]!.samples);
    expect(samples[0]).toBeCloseTo(0.1);
    expect(samples[1]).toBeCloseTo(0.2);
  });

  it('returns the TTS preparation failure instead of reporting voice as started', async () => {
    const voice = createVoice({
      defaultProfile: { profileId: 'default', name: 'Default', source: { kind: 'built_in', voiceId: 'Xiaoyu' } },
      recognizer: unusedRecognizer,
      synthesizer: {
        async prepare() {
          return { status: 'failed', failure: { code: 'tts_prepare_failed', message: 'Model load failed.' } };
        },
        async *synthesize() {},
      },
      player: unusedPlayer,
    });
    const host = createVoiceOperations({
      voice,
      profileAudioPicker: { async chooseReferenceAudio() { return { status: 'cancelled' }; } },
    });

    await expect(host.startSession({ boundSessionId: 'session:one' })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'tts_prepare_failed', message: 'Model load failed.' },
    });
  });
});

const unusedRecognizer: SpeechRecognizer = { async recognize() { return { status: 'empty' }; } };
const unusedSynthesizer: SpeechSynthesizer = {
  async prepare() { return { status: 'ready' }; },
  async *synthesize() {},
};
const unusedPlayer: SpeechPlayer = {
  async play() { return { status: 'played' }; },
  async stop() {},
};
