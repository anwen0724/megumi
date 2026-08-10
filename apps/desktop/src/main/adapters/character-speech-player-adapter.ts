/*
 * Adapts Voice SpeechPlayer to the Character renderer's Web Audio playback surface.
 * Completion is based on renderer acknowledgement after scheduled audio actually ends.
 */
import type { PlaySpeechResult, SpeechPlayer } from '@megumi/voice';
import { IPC_CHANNELS } from '../ipc/channels';

export interface CharacterPlaybackResult {
  readonly segmentId: string;
  readonly status: 'played' | 'stopped' | 'failed';
  readonly message?: string;
}

export interface CharacterSpeechPlayerAdapter extends SpeechPlayer {
  handlePlaybackResult(result: CharacterPlaybackResult): void;
}

export function createCharacterSpeechPlayerAdapter(options: {
  readonly send: (channel: string, payload: unknown) => boolean;
}): CharacterSpeechPlayerAdapter {
  const pending = new Map<string, (result: PlaySpeechResult) => void>();

  return {
    async play(request, operationOptions) {
      if (operationOptions?.signal?.aborted) return { status: 'stopped' };
      const playbackResult = new Promise<PlaySpeechResult>((resolve) => {
        pending.set(request.segmentId, resolve);
      });
      let sent = false;
      for await (const chunk of request.audio) {
        if (operationOptions?.signal?.aborted) {
          pending.delete(request.segmentId);
          return { status: 'stopped' };
        }
        const samples = chunk.pcm.samples.slice();
        sent = options.send(IPC_CHANNELS.voice.playbackChunk, {
          segmentId: request.segmentId,
          samples: samples.buffer,
          sampleRate: chunk.pcm.sampleRate,
          final: chunk.final,
        });
        if (!sent) {
          pending.delete(request.segmentId);
          return {
            status: 'failed',
            failure: { code: 'character_playback_unavailable', message: 'Character playback surface is unavailable.' },
          };
        }
      }
      if (!sent) {
        pending.delete(request.segmentId);
        return {
          status: 'failed',
          failure: { code: 'voice_audio_empty', message: 'Speech synthesis produced no audio.' },
        };
      }
      return playbackResult;
    },
    async stop(request) {
      options.send(IPC_CHANNELS.voice.playbackStop, { reason: request.reason });
      for (const resolve of pending.values()) resolve({ status: 'stopped' });
      pending.clear();
    },
    handlePlaybackResult(result) {
      const resolve = pending.get(result.segmentId);
      if (!resolve) return;
      pending.delete(result.segmentId);
      if (result.status === 'played') resolve({ status: 'played' });
      else if (result.status === 'stopped') resolve({ status: 'stopped' });
      else resolve({
        status: 'failed',
        failure: { code: 'character_playback_failed', message: result.message ?? 'Character playback failed.' },
      });
    },
  };
}
