import { describe, expect, it, vi } from 'vitest';
import { createSpeechPlaybackController } from '@megumi/desktop/renderer/features/character-presence/speech-playback-controller';

describe('SpeechPlaybackController', () => {
  it('plays streamed chunks in order and reports completion only after the final audio ends', async () => {
    const played: number[] = [];
    const report = vi.fn();
    const controller = createSpeechPlaybackController({
      backend: {
        async play(samples) { played.push(samples[0] ?? 0); },
        stop: vi.fn(),
        dispose: vi.fn(),
      },
      report,
    });

    controller.acceptChunk({ segmentId: 'segment-1', samples: new Float32Array([0.1]).buffer, sampleRate: 24_000, final: false });
    controller.acceptChunk({ segmentId: 'segment-1', samples: new Float32Array([0.2]).buffer, sampleRate: 24_000, final: true });
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith({ segmentId: 'segment-1', status: 'played' }));

    expect(played).toEqual([expect.closeTo(0.1), expect.closeTo(0.2)]);
  });

  it('invalidates scheduled chunks and reports stopped when Main interrupts playback', async () => {
    const report = vi.fn();
    const stop = vi.fn();
    const controller = createSpeechPlaybackController({
      backend: { play: vi.fn(() => new Promise<void>(() => undefined)), stop, dispose: vi.fn() },
      report,
    });
    controller.acceptChunk({ segmentId: 'segment-2', samples: new Float32Array([0.1]).buffer, sampleRate: 24_000, final: true });

    await controller.stop();

    expect(stop).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ segmentId: 'segment-2', status: 'stopped' });
  });
});
