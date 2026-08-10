/* Implements the host-neutral Voice operations exposed by Product. */

import type { Voice } from '@megumi/voice';
import type { VoiceProfileAudioPicker } from '../host/capabilities/voice-profile-audio-picker';
import type { VoiceHost, VoiceHostMutationResult } from '../host/voice-host';

export interface CreateVoiceOperationsOptions {
  readonly voice: Voice;
  readonly profileAudioPicker: VoiceProfileAudioPicker;
}

export function createVoiceOperations(options: CreateVoiceOperationsOptions): VoiceHost {
  const { voice } = options;

  return {
    async getSnapshot() {
      return voice.sessions.getSnapshot();
    },

    async getModelStatus() {
      return voice.models.getStatus();
    },

    async checkModelUpdates() {
      return voice.models.checkForUpdates();
    },

    async prepareModels(request) {
      const result = await voice.models.prepare(request);
      if (result.status === 'ready') return { status: 'ok' };
      if (result.status === 'cancelled') return { status: 'cancelled' };
      return { status: 'failed', failure: result.failure };
    },

    async cancelModelPreparation() {
      await voice.models.cancelPreparation();
      return { status: 'ok' };
    },

    async listProfiles() {
      const selected = voice.profiles.getSelected();
      const selectedProfileId = selected.status === 'selected' ? selected.profile.profileId : undefined;
      return {
        status: 'ok',
        profiles: voice.profiles.list().profiles.map((profile) => ({
          profileId: profile.profileId,
          name: profile.name,
          builtIn: profile.builtIn,
          selected: profile.profileId === selectedProfileId,
        })),
      };
    },

    async importProfile(request) {
      const picked = await options.profileAudioPicker.chooseReferenceAudio();
      if (picked.status === 'cancelled') return { status: 'cancelled' };
      const result = await voice.profiles.import({
        name: request.name,
        sourceAudioPath: picked.sourceAudioPath,
      });
      return result.status === 'imported'
        ? { status: 'ok' }
        : failed('voice_profile_id_conflict', 'Could not create a unique Voice Profile.');
    },

    async renameProfile(request) {
      const result = voice.profiles.rename(request);
      return result.status === 'renamed' ? { status: 'ok' } : { status: 'not_found' };
    },

    async removeProfile(request) {
      const result = await voice.profiles.remove(request);
      if (result.status === 'removed') return { status: 'ok' };
      if (result.status === 'not_found') return { status: 'not_found' };
      return { status: 'blocked', reason: result.reason };
    },

    async selectProfile(request) {
      const result = voice.profiles.select(request);
      return result.status === 'selected' ? { status: 'ok' } : { status: 'not_found' };
    },

    async startSession(request) {
      const result = await voice.sessions.start(request);
      if (result.status === 'started' || result.status === 'already_active') return { status: 'ok' };
      if (result.status === 'cancelled') return { status: 'cancelled' };
      if (result.status === 'failed') return { status: 'failed', failure: result.failure };
      return { status: 'blocked', reason: 'voice_profile_unavailable' };
    },

    async setMuted(request) {
      const result = voice.sessions.setMuted(request);
      return result.status === 'updated'
        ? { status: 'ok' }
        : { status: 'blocked', reason: 'voice_session_not_active' };
    },

    async interrupt() {
      const result = await voice.sessions.interrupt();
      return result.status === 'interrupted'
        ? { status: 'ok' }
        : { status: 'blocked', reason: 'voice_session_not_active' };
    },

    async endSession() {
      await voice.sessions.end({ reason: 'user' });
      return { status: 'ok' };
    },
  };
}

function failed(code: string, message: string): VoiceHostMutationResult {
  return { status: 'failed', failure: { code, message } };
}
