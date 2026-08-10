import { describe, expect, it, vi } from 'vitest';
import {
  createVoice,
  type SpeechPlayer,
  type SpeechRecognizer,
  type SpeechSynthesizer,
} from '../../../packages/voice/src/index';

describe('Voice sessions', () => {
  it('prepares the selected voice before the session starts listening', async () => {
    let finishPreparation!: () => void;
    const prepare = vi.fn(() => new Promise<{ status: 'ready' }>((resolve) => {
      finishPreparation = () => resolve({ status: 'ready' });
    }));
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: { prepare, async *synthesize() {} },
      player: unusedPlayer,
    });

    const starting = voice.sessions.start({ boundSessionId: 'session:one' });

    expect(prepare).toHaveBeenCalledWith({
      voiceProfileId: 'voice-profile:default',
      voice: { kind: 'built_in', voiceId: 'Xiaoyu' },
    }, { signal: expect.any(AbortSignal) });
    expect(voice.sessions.getSnapshot()).toMatchObject({
      status: 'preparing',
      boundSessionId: 'session:one',
    });

    finishPreparation();
    await expect(starting).resolves.toMatchObject({
      status: 'started',
      snapshot: { status: 'listening' },
    });
  });

  it('does not reopen the microphone state when the session ends during preparation', async () => {
    let finishPreparation!: () => void;
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: {
        prepare: () => new Promise((resolve) => {
          finishPreparation = () => resolve({ status: 'ready' });
        }),
        async *synthesize() {},
      },
      player: unusedPlayer,
    });

    const starting = voice.sessions.start({ boundSessionId: 'session:one' });
    await voice.sessions.end({ reason: 'character_hidden' });
    finishPreparation();

    await expect(starting).resolves.toEqual({ status: 'cancelled', snapshot: { status: 'idle' } });
    expect(voice.sessions.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('stays idle and returns the preparation failure when TTS cannot be prepared', async () => {
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: {
        async prepare() {
          return { status: 'failed' as const, failure: { code: 'tts_prepare_failed', message: 'Could not load TTS.' } };
        },
        async *synthesize() {},
      },
      player: unusedPlayer,
    });

    await expect(voice.sessions.start({ boundSessionId: 'session:one' })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'tts_prepare_failed', message: 'Could not load TTS.' },
      snapshot: { status: 'idle' },
    });
    expect(voice.sessions.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('fixes the bound Session and selected Voice Profile until the Voice Session ends', async () => {
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      ids: { createVoiceProfileId: () => 'voice-profile:alternate' },
    });

    expect(voice.sessions.getSnapshot()).toMatchObject({ status: 'idle' });

    expect(await voice.sessions.start({ boundSessionId: 'session:one' })).toMatchObject({
      status: 'started',
      snapshot: {
        status: 'listening',
        boundSessionId: 'session:one',
        voiceProfileId: 'voice-profile:default',
        muted: false,
      },
    });

    await voice.profiles.import({
      name: 'Alternate',
      sourceAudioPath: 'C:/voices/alternate.wav',
    });
    expect(voice.profiles.select({ profileId: 'voice-profile:alternate' })).toEqual({
      status: 'selected',
      profileId: 'voice-profile:alternate',
    });
    expect(voice.sessions.getSnapshot()).toMatchObject({
      boundSessionId: 'session:one',
      voiceProfileId: 'voice-profile:default',
    });

    expect(voice.sessions.setMuted({ muted: true })).toMatchObject({
      status: 'updated',
      snapshot: { status: 'listening', muted: true },
    });
    expect(await voice.sessions.end()).toMatchObject({
      status: 'ended',
      snapshot: { status: 'idle' },
    });

    expect(await voice.sessions.start({ boundSessionId: 'session:two' })).toMatchObject({
      status: 'started',
      snapshot: {
        boundSessionId: 'session:two',
        voiceProfileId: 'voice-profile:alternate',
      },
    });
  });
});

const unusedRecognizer: SpeechRecognizer = {
  async recognize() {
    throw new Error('Recognizer should not be called in this test.');
  },
};

const unusedSynthesizer: SpeechSynthesizer = {
  async prepare() { return { status: 'ready' }; },
  async *synthesize() {
    throw new Error('Synthesizer should not be called in this test.');
  },
};

const unusedPlayer: SpeechPlayer = {
  async play() {
    throw new Error('Player should not be called in this test.');
  },
  async stop() {},
};
