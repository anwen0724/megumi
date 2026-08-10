import { describe, expect, it } from 'vitest';
import {
  createVoice,
  type SpeechPlayer,
  type SpeechRecognizer,
  type SpeechSynthesizer,
} from '../../../packages/voice/src/index';

describe('Voice sessions', () => {
  it('fixes the bound Session and selected Voice Profile until the Voice Session ends', async () => {
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        referenceAudioPath: 'profiles/default/reference.wav',
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
