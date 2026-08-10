import { describe, expect, it } from 'vitest';
import { createVoice, type SpeechPlayer, type SpeechRecognizer, type SpeechSynthesizer } from '../../../packages/voice/src';
import { createVoiceOperations } from '../../../packages/product/src/operations/voice-operations';

describe('Product Voice operations', () => {
  it('coordinates host audio selection without exposing local paths in Host results', async () => {
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        referenceAudioPath: 'profiles/default/reference.wav',
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
        { profileId: 'voice-profile:default', name: 'Default', builtIn: true, selected: true },
        { profileId: 'voice-profile:imported', name: 'Warm voice', builtIn: false, selected: false },
      ],
    });
  });
});

const unusedRecognizer: SpeechRecognizer = { async recognize() { return { status: 'empty' }; } };
const unusedSynthesizer: SpeechSynthesizer = { async *synthesize() {} };
const unusedPlayer: SpeechPlayer = {
  async play() { return { status: 'played' }; },
  async stop() {},
};
