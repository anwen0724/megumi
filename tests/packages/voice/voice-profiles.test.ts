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
      name: 'Xiaoyu',
      source: { kind: 'built_in' as const, voiceId: 'Xiaoyu' },
    };
    const builtInProfiles = [{
      profileId: 'voice-profile:moss:ava',
      name: 'Ava',
      source: { kind: 'built_in' as const, voiceId: 'Ava' },
    }];

    const first = createVoiceProfiles(defaultProfile, {
      createVoiceProfileId: () => 'voice-profile:imported',
    }, storage, builtInProfiles);
    const imported = await first.import({ name: 'Warm voice', sourceAudioPath });
    expect(imported.status).toBe('imported');
    if (imported.status !== 'imported') throw new Error('Expected imported Voice Profile.');
    expect(imported.profile.source).toEqual({
      kind: 'reference_audio',
      referenceAudioPath: path.join(profilesPath, 'voice-profile_imported', 'reference.wav'),
    });
    if (imported.profile.source.kind !== 'reference_audio') throw new Error('Expected a reference profile.');
    expect(imported.profile.source.referenceAudioPath).toBe(
      path.join(profilesPath, 'voice-profile_imported', 'reference.wav'),
    );
    expect(fs.readFileSync(imported.profile.source.referenceAudioPath, 'utf8')).toBe('reference-audio');
    expect(first.list().profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: 'voice-profile:default', source: { kind: 'built_in', voiceId: 'Xiaoyu' } }),
      expect.objectContaining({ profileId: 'voice-profile:moss:ava', source: { kind: 'built_in', voiceId: 'Ava' } }),
    ]));
    expect(first.select({ profileId: imported.profile.profileId })).toEqual({
      status: 'selected',
      profileId: 'voice-profile:imported',
    });

    const restored = createVoiceProfiles(defaultProfile, {
      createVoiceProfileId: () => 'voice-profile:unused',
    }, storage, builtInProfiles);
    expect(restored.getSelected()).toMatchObject({
      status: 'selected',
      profile: { profileId: 'voice-profile:imported', name: 'Warm voice' },
    });
  });
});
