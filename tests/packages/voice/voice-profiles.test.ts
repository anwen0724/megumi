// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileVoiceProfileStorage,
  createVoiceProfiles,
} from '../../../packages/voice/src';

describe('Voice Profiles', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directoryPath of temporaryDirectories.splice(0)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });

  it('copies imported reference audio into managed storage and restores selection', async () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-voice-profile-'));
    temporaryDirectories.push(rootPath);
    const sourceAudioPath = path.join(rootPath, 'outside-reference.wav');
    fs.writeFileSync(sourceAudioPath, Buffer.from('reference-audio'));
    const profilesPath = path.join(rootPath, 'profiles');
    const storage = createFileVoiceProfileStorage({ profilesPath });
    const defaultProfile = {
      profileId: 'voice-profile:default',
      name: 'Default',
      referenceAudioPath: path.join(rootPath, 'default.wav'),
    };

    const first = createVoiceProfiles(defaultProfile, {
      createVoiceProfileId: () => 'voice-profile:imported',
    }, storage);
    const imported = await first.import({ name: 'Warm voice', sourceAudioPath });
    expect(imported.status).toBe('imported');
    if (imported.status !== 'imported') throw new Error('Expected imported Voice Profile.');
    expect(imported.profile.referenceAudioPath).toBe(
      path.join(profilesPath, 'voice-profile_imported', 'reference.wav'),
    );
    expect(fs.readFileSync(imported.profile.referenceAudioPath, 'utf8')).toBe('reference-audio');
    expect(first.select({ profileId: imported.profile.profileId })).toEqual({
      status: 'selected',
      profileId: 'voice-profile:imported',
    });

    const restored = createVoiceProfiles(defaultProfile, {
      createVoiceProfileId: () => 'voice-profile:unused',
    }, storage);
    expect(restored.getSelected()).toMatchObject({
      status: 'selected',
      profile: { profileId: 'voice-profile:imported', name: 'Warm voice' },
    });
  });
});
