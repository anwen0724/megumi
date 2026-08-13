// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerVoiceInputHandler } from '@megumi/desktop/main/ipc/handlers/voice-input.handler';
import type { ElectronVoiceInputAdapter } from '@megumi/desktop/main/adapters/voice-input/electron-voice-input-adapter';

function fakeAdapter(): { adapter: ElectronVoiceInputAdapter; acceptFrame: ReturnType<typeof vi.fn> } {
  const acceptFrame = vi.fn();
  const adapter = { acceptFrame } as unknown as ElectronVoiceInputAdapter;
  return { adapter, acceptFrame };
}

describe('registerVoiceInputHandler', () => {
  it('validates frame shape, size, sample rate, and sequence before the Adapter sees it', () => {
    const on = vi.fn();
    const { adapter, acceptFrame } = fakeAdapter();
    registerVoiceInputHandler({ adapter }, { ipcMain: { on } as never });

    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.voice.inputFrame, expect.any(Function));
    const handler = on.mock.calls[0]![1] as (event: unknown, payload: unknown) => void;
    const samples = new Float32Array(512).fill(0.1);

    handler({}, { generation: 1, sequence: 3, sampleRate: 16_000, samples: samples.buffer });

    expect(acceptFrame).toHaveBeenCalledWith({
      generation: 1,
      sequence: 3,
      sampleRate: 16_000,
      samples: expect.any(Float32Array),
    });
    expect((acceptFrame.mock.calls[0]![0] as { samples: Float32Array }).samples.length).toBe(512);
  });

  it('drops malformed, wrong-size, wrong-rate, and stale frames without touching the Adapter', () => {
    const on = vi.fn();
    const { adapter, acceptFrame } = fakeAdapter();
    registerVoiceInputHandler({ adapter }, { ipcMain: { on } as never });
    const handler = on.mock.calls[0]![1] as (event: unknown, payload: unknown) => void;

    handler({}, { generation: 1, sequence: 0, sampleRate: 16_000, samples: new ArrayBuffer(1024) });
    handler({}, { generation: 1, sequence: 0, sampleRate: 48_000, samples: new Float32Array(512).buffer });
    handler({}, { generation: -1, sequence: 0, sampleRate: 16_000, samples: new Float32Array(512).buffer });
    handler({}, { generation: 1, sequence: 1.5, sampleRate: 16_000, samples: new Float32Array(512).buffer });
    handler({}, { generation: 1, samples: new Float32Array(512).buffer });
    handler({}, 'not-a-frame');
    handler({}, undefined);

    expect(acceptFrame).not.toHaveBeenCalled();
  });

  it('keeps the frame channel outside the business request envelope', () => {
    const on = vi.fn();
    const { adapter } = fakeAdapter();
    registerVoiceInputHandler({ adapter }, { ipcMain: { on } as never });
    expect(on.mock.calls[0]![0]).toBe(IPC_CHANNELS.voice.inputFrame);
    expect(IPC_CHANNELS.voice.inputFrame).not.toMatch(/^voice:(session|models|profiles|profile|playback|audio)/);
  });
});
