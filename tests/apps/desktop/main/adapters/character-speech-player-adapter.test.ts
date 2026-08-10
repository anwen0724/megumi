// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCharacterSpeechPlayerAdapter } from '@megumi/desktop/main/adapters/character-speech-player-adapter';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';

describe('CharacterSpeechPlayerAdapter', () => {
  it('streams synthesized chunks to the Character renderer and resolves on actual playback result', async () => {
    const sent: Array<{ channel: string; payload: any }> = [];
    const player = createCharacterSpeechPlayerAdapter({
      send: (channel, payload) => { sent.push({ channel, payload }); return true; },
    });
    const playing = player.play({
      segmentId: 'segment-1',
      audio: (async function* () {
        yield { pcm: { samples: new Float32Array([0.1]), sampleRate: 24_000, channels: 1 as const }, final: false };
        yield { pcm: { samples: new Float32Array([0.2]), sampleRate: 24_000, channels: 1 as const }, final: true };
      }()),
    });
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(sent.map((item) => item.channel)).toEqual([
      IPC_CHANNELS.voice.playbackChunk,
      IPC_CHANNELS.voice.playbackChunk,
    ]);
    expect(sent[1]?.payload).toMatchObject({ segmentId: 'segment-1', final: true, sampleRate: 24_000 });

    player.handlePlaybackResult({ segmentId: 'segment-1', status: 'played' });
    await expect(playing).resolves.toEqual({ status: 'played' });
  });

  it('stops pending playback and tells the renderer to discard scheduled audio', async () => {
    const send = vi.fn(() => true);
    const player = createCharacterSpeechPlayerAdapter({ send });
    const playing = player.play({
      segmentId: 'segment-2',
      audio: (async function* () {
        yield { pcm: { samples: new Float32Array([0.1]), sampleRate: 24_000, channels: 1 as const }, final: true };
      }()),
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalled());

    await player.stop({ reason: 'interrupted' });

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.voice.playbackStop, { reason: 'interrupted' });
    await expect(playing).resolves.toEqual({ status: 'stopped' });
  });
});
