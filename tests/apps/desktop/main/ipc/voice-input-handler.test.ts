// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import {
  createValidatingFramePort,
  registerVoiceInputHandler,
} from '@megumi/desktop/main/ipc/handlers/voice-input.handler';
import type { ElectronVoiceInputAdapter } from '@megumi/desktop/main/adapters/voice-input/electron-voice-input-adapter';

function fakeAdapter(): { adapter: ElectronVoiceInputAdapter; acceptFrame: ReturnType<typeof vi.fn>; attached: ReturnType<typeof vi.fn> } {
  const acceptFrame = vi.fn();
  const attached = vi.fn();
  const adapter = {
    acceptFrame,
    attachFramePort: attached,
  } as unknown as ElectronVoiceInputAdapter;
  return { adapter, acceptFrame, attached };
}

interface FakePort {
  listeners: Array<(event: { data: unknown }) => void>;
  started: boolean;
  closed: boolean;
  posted: unknown[];
  start(): void;
  close(): void;
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

function fakePort(): FakePort {
  return {
    listeners: [],
    started: false,
    closed: false,
    posted: [],
    start() { this.started = true; },
    close() { this.closed = true; },
    postMessage(message) { this.posted.push(message); },
    on(_event, listener) { this.listeners.push(listener); },
  };
}

describe('registerVoiceInputHandler', () => {
  it('receives the Renderer MessagePort on the dedicated channel and hands the Adapter a validating port', () => {
    const on = vi.fn();
    const { adapter, attached } = fakeAdapter();
    registerVoiceInputHandler({ adapter }, { ipcMain: { on } as never });

    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.voice.inputPort, expect.any(Function));
    const port = fakePort();
    const handler = on.mock.calls[0]![1] as (event: { ports: unknown[] }) => void;
    handler({ ports: [port] });

    expect(port.started).toBe(true);
    expect(attached).toHaveBeenCalledTimes(1);
    const framePort = attached.mock.calls[0]![0] as {
      onMessage: (listener: (frame: unknown) => void) => void;
      postMessage: (message: unknown) => void;
      close: () => void;
    };

    // Valid frame reaches the Adapter through the wrapped port.
    const listener = vi.fn();
    framePort.onMessage(listener);
    const samples = new Float32Array(512).fill(0.1);
    port.listeners[0]!({ data: { generation: 1, sequence: 3, sampleRate: 16_000, samples } });
    expect(listener).toHaveBeenCalledWith({
      generation: 1,
      sequence: 3,
      sampleRate: 16_000,
      samples: expect.any(Float32Array),
    });

    // Credits and close pass through to the real port.
    framePort.postMessage({ type: 'credit', count: 2 });
    expect(port.posted).toEqual([{ type: 'credit', count: 2 }]);
    framePort.close();
    expect(port.closed).toBe(true);
  });

  it('drops malformed, wrong-size, wrong-rate, and stale frames before the Adapter sees them', () => {
    const { adapter } = fakeAdapter();
    const port = fakePort();
    const framePort = createValidatingFramePort({
      start: vi.fn(),
      close: vi.fn(),
      postMessage: vi.fn(),
      on: (_event, listener) => { port.listeners.push(listener as never); },
    });
    const listener = vi.fn();
    framePort.onMessage(listener);

    port.listeners[0]!({ data: { generation: 1, sequence: 0, sampleRate: 16_000, samples: new Float32Array(256) } });
    port.listeners[0]!({ data: { generation: 1, sequence: 0, sampleRate: 48_000, samples: new Float32Array(512) } });
    port.listeners[0]!({ data: { generation: -1, sequence: 0, sampleRate: 16_000, samples: new Float32Array(512) } });
    port.listeners[0]!({ data: { generation: 1, sequence: 1.5, sampleRate: 16_000, samples: new Float32Array(512) } });
    port.listeners[0]!({ data: { generation: 1, samples: new Float32Array(512) } });
    port.listeners[0]!({ data: 'not-a-frame' });
    port.listeners[0]!({ data: undefined });

    expect(listener).not.toHaveBeenCalled();
    void adapter;
  });

  it('keeps the frame channel outside the business request envelope', () => {
    const on = vi.fn();
    const { adapter } = fakeAdapter();
    registerVoiceInputHandler({ adapter }, { ipcMain: { on } as never });
    expect(on.mock.calls[0]![0]).toBe(IPC_CHANNELS.voice.inputPort);
    expect(IPC_CHANNELS.voice.inputPort).not.toMatch(/^voice:(session|models|profiles|profile|playback)/);
  });
});
