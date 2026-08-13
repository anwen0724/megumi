import { describe, expect, it, vi } from 'vitest';
import { openVoiceInputFrameSender } from '@megumi/desktop/renderer/features/voice-input/frame-channel';

interface FakePort {
  posted: Array<{ message: unknown; transfer?: unknown[] }>;
  onmessage: ((event: { data: unknown }) => void) | null;
  closed: boolean;
  postMessage(message: unknown, transfer?: unknown[]): void;
  close(): void;
}

function fakeChannel(): { port1: FakePort; port2: MessagePort } {
  const port1: FakePort = {
    posted: [],
    onmessage: null,
    closed: false,
    postMessage(message, transfer) { port1.posted.push({ message, transfer }); },
    close() { port1.closed = true; },
  };
  return {
    port1,
    port2: {} as MessagePort,
  };
}

function frame(sequence: number) {
  return {
    generation: 1,
    sequence,
    sampleRate: 16_000 as const,
    samples: new Float32Array(512).fill(0.1),
  };
}

describe('Voice input frame channel', () => {
  it('copies frames across Electron MessagePortMain and hands the port to Main', () => {
    const channel = fakeChannel();
    const postFramePort = vi.fn();
    const sender = openVoiceInputFrameSender({
      postFramePort,
      createChannel: () => channel as never,
    });

    const first = frame(0);
    sender.sendFrame(first);

    expect(postFramePort).toHaveBeenCalledWith(channel.port2);
    expect(channel.port1.posted).toHaveLength(1);
    expect(channel.port1.posted[0]!.message).toEqual(first);
    // Electron 33 delivers `null` to MessagePortMain when a typed-array buffer
    // is included in this DOM-port transfer list. A structured clone preserves
    // the Float32Array; the Main-to-Worker hop performs the real transfer.
    expect(channel.port1.posted[0]!.transfer).toBeUndefined();
  });

  it('bounds in-flight frames by the credit cap and drops beyond it', () => {
    const channel = fakeChannel();
    const sender = openVoiceInputFrameSender({
      postFramePort: () => undefined,
      maxInFlight: 8,
      createChannel: () => channel as never,
    });

    for (let sequence = 0; sequence < 100; sequence += 1) {
      sender.sendFrame(frame(sequence));
    }

    expect(channel.port1.posted).toHaveLength(8);
  });

  it('survives a producer far faster than the consumer without unbounded memory', () => {
    const channel = fakeChannel();
    const sender = openVoiceInputFrameSender({
      postFramePort: () => undefined,
      maxInFlight: 32,
      createChannel: () => channel as never,
    });

    // 10_000 frames, zero credits returned: only the cap is ever in flight.
    for (let sequence = 0; sequence < 10_000; sequence += 1) {
      sender.sendFrame(frame(sequence));
    }
    expect(channel.port1.posted).toHaveLength(32);

    // Credits return slowly; the channel never exceeds the cap in total.
    for (let count = 0; count < 5; count += 1) {
      channel.port1.onmessage?.({ data: { type: 'credit', count: 4 } });
      for (let sequence = 0; sequence < 4; sequence += 1) {
        sender.sendFrame(frame(10_000 + count * 4 + sequence));
      }
    }
    expect(channel.port1.posted).toHaveLength(32 + 5 * 4);
  });

  it('ignores malformed credit messages and closes idempotently', () => {
    const channel = fakeChannel();
    const sender = openVoiceInputFrameSender({
      postFramePort: () => undefined,
      maxInFlight: 2,
      createChannel: () => channel as never,
    });

    sender.sendFrame(frame(0));
    sender.sendFrame(frame(1));
    sender.sendFrame(frame(2));
    expect(channel.port1.posted).toHaveLength(2);

    channel.port1.onmessage?.({ data: { type: 'credit', count: -5 } });
    channel.port1.onmessage?.({ data: { type: 'credit', count: 999 } });
    channel.port1.onmessage?.({ data: { type: 'bogus' } });
    channel.port1.onmessage?.({ data: null });
    // The cap clamps replenishment: never more than maxInFlight.
    sender.sendFrame(frame(3));
    sender.sendFrame(frame(4));
    expect(channel.port1.posted).toHaveLength(4);

    sender.close();
    sender.close();
    expect(channel.port1.closed).toBe(true);
  });
});
