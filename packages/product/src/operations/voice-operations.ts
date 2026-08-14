/* Implements the host-neutral Voice operations exposed by Product. */

import type { Voice } from '@megumi/voice';
import type { VoiceHost } from '../host/voice-host';

export interface CreateVoiceOperationsOptions {
  readonly voice: Voice;
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

    async getModelCapabilityStatus(request) {
      return voice.models.getCapabilityStatus(request.capability);
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

    async startSession(request) {
      const result = await voice.sessions.start(request);
      if (result.status === 'started' || result.status === 'already_active') {
        return { status: 'ok', ...(result.generation !== undefined ? { generation: result.generation } : {}) };
      }
      if (result.status === 'cancelled') return { status: 'cancelled' };
      return { status: 'failed', failure: result.failure };
    },

    async startManualUtterance() {
      const result = voice.sessions.startManualUtterance();
      return result.status === 'started'
        ? { status: 'ok' }
        : { status: 'blocked', reason: 'voice_session_not_active' };
    },

    async finishManualUtterance() {
      const result = voice.sessions.finishManualUtterance();
      return result.status === 'finished'
        ? { status: 'ok' }
        : { status: 'blocked', reason: 'voice_session_not_active' };
    },

    async setMuted(request) {
      const result = voice.sessions.setMuted(request);
      return result.status === 'updated'
        ? { status: 'ok' }
        : { status: 'blocked', reason: 'voice_session_not_active' };
    },

    async endSession() {
      await voice.sessions.end({ reason: 'user' });
      return { status: 'ok' };
    },
  };
}
