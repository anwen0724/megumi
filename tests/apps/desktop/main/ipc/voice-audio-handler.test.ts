// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerVoiceAudioHandler } from '@megumi/desktop/main/ipc/handlers/voice-audio.handler';
import type { SubmitVoiceUtteranceResult } from '@megumi/voice';

describe('registerVoiceAudioHandler', () => {
  it('converts one bounded PCM buffer into one Voice utterance submission', async () => {
    const handle = vi.fn();
    const submitUtterance = vi.fn(async (): Promise<SubmitVoiceUtteranceResult> => ({
      status: 'empty',
      snapshot: { status: 'idle' },
    }));
    registerVoiceAudioHandler({ submitUtterance }, { handle });
    const handler = handle.mock.calls[0]?.[1];
    const samples = new Float32Array([0.1, -0.1, 0.2]);

    const result = await handler({}, {
      samples: samples.buffer,
      sampleRate: 16_000,
      language: 'zh',
    });

    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.voice.audioSubmit, expect.any(Function));
    expect(submitUtterance).toHaveBeenCalledWith({
      pcm: { samples: expect.any(Float32Array), sampleRate: 16_000, channels: 1 },
      language: 'zh',
    });
    expect(result.status).toBe('empty');
  });

  it('rejects invalid or excessively long buffers before Voice receives them', async () => {
    const handle = vi.fn();
    const submitUtterance = vi.fn();
    registerVoiceAudioHandler({ submitUtterance }, { handle });
    const handler = handle.mock.calls[0]?.[1];

    await expect(handler({}, {
      samples: new ArrayBuffer(4 * 16_000 * 61),
      sampleRate: 16_000,
      language: 'auto',
    })).rejects.toThrow();
    expect(submitUtterance).not.toHaveBeenCalled();
  });
});
