import { describe, expect, it, vi } from 'vitest';
import {
  createMicrophoneCapture,
  measureFrameLevels,
} from '@megumi/desktop/renderer/features/voice-input/microphone-capture';

interface FakeWorkletNode {
  readonly port: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function fakeStream() {
  const stop = vi.fn();
  return { getTracks: () => [{ stop }], stop };
}

function captureWithMocks() {
  const frames: Float32Array[] = [];
  const streams: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
  const workletNodes: FakeWorkletNode[] = [];
  const getUserMedia = vi.fn(async () => {
    const stream = fakeStream();
    streams.push(stream);
    return stream as unknown as MediaStream;
  });
  const close = vi.fn();
  const addModule = vi.fn(async () => undefined);
  const createWorkletNode = vi.fn(() => {
    const node: FakeWorkletNode = {
      port: { onmessage: null, postMessage: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    workletNodes.push(node);
    return node;
  });
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    sampleRate: 16_000,
    state: 'running' as const,
    close,
    audioWorklet: { addModule },
    createMediaStreamSource: vi.fn(() => source),
    createWorkletNode,
    resume: vi.fn(async () => undefined),
  };
  const createAudioContext = vi.fn(() => context as unknown as AudioContext);
  const capture = createMicrophoneCapture({
    getUserMedia,
    createAudioContext,
    createWorkletNode: (value) => createWorkletNode(value),
    workletUrl: 'file:///worklet.js',
  });
  capture.setFrameHandler((frame) => frames.push(frame));
  const emitWorkletFrame = (samples: Float32Array) => {
    const node = workletNodes[workletNodes.length - 1]!;
    node.port.onmessage?.({ data: { samples } });
  };
  return {
    capture, frames, streams, getUserMedia, close, addModule, createAudioContext, workletNodes, emitWorkletFrame, source,
  };
}

describe('Microphone capture', () => {
  it('opens the selected device with 16 kHz constraints and verifies the context sample rate', async () => {
    const { capture, getUserMedia, addModule, workletNodes } = captureWithMocks();

    await expect(capture.open({ inputDeviceId: 'mic:42' })).resolves.toEqual({
      status: 'opened',
      sampleRate: 16_000,
      fallbackToDefault: false,
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        deviceId: { exact: 'mic:42' },
      },
    });
    expect(addModule).toHaveBeenCalledWith('file:///worklet.js');
    expect(workletNodes).toHaveLength(1);
    expect(capture.getSnapshot()).toMatchObject({ status: 'opening' });
  });

  it('falls back to the system default device when the selected device disappears', async () => {
    const { capture, getUserMedia } = captureWithMocks();
    const notFound = new DOMException('Requested device not found', 'NotFoundError');
    getUserMedia
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce(fakeStream() as unknown as MediaStream);

    await expect(capture.open({ inputDeviceId: 'mic:missing' })).resolves.toEqual({
      status: 'opened',
      sampleRate: 16_000,
      fallbackToDefault: true,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(capture.getSnapshot().fallbackToDefault).toBe(true);
  });

  it('keeps permission denial, missing device, and open failures distinct', async () => {
    const { capture, getUserMedia } = captureWithMocks();
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expect(capture.open({})).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'microphone_permission_denied' },
    });

    const missing = captureWithMocks();
    missing.getUserMedia.mockRejectedValueOnce(new DOMException('no device', 'NotFoundError'));
    await expect(missing.capture.open({})).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'microphone_device_missing' },
    });

    const broken = captureWithMocks();
    broken.getUserMedia.mockRejectedValueOnce(new DOMException('busted', 'NotReadableError'));
    await expect(broken.capture.open({})).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'microphone_device_failed' },
    });
  });

  it('fails capture initialization when the AudioContext is not 16 kHz', async () => {
    const { capture, createAudioContext, streams } = captureWithMocks();
    createAudioContext.mockReturnValueOnce({ sampleRate: 48_000, close: vi.fn() } as AudioContext);

    await expect(capture.open({})).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'microphone_sample_rate_mismatch' },
    });
    expect(streams[0]!.stop).toHaveBeenCalled();
  });

  it('treats AudioWorklet module failures as capture failures', async () => {
    const { capture, addModule, streams } = captureWithMocks();
    addModule.mockRejectedValueOnce(new Error('worklet boom'));

    await expect(capture.open({})).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'microphone_worklet_failed' },
    });
    expect(streams[0]!.stop).toHaveBeenCalled();
  });

  it('stays opening until the first real PCM frame arrives, then reports capturing with real levels', async () => {
    const { capture, emitWorkletFrame, frames } = captureWithMocks();
    await capture.open({});

    expect(capture.getSnapshot()).toMatchObject({ status: 'opening', framesReceived: false });

    const samples = new Float32Array(512).fill(0.25);
    emitWorkletFrame(samples);

    expect(capture.getSnapshot()).toMatchObject({ status: 'capturing', framesReceived: true });
    const { rms, peak } = measureFrameLevels(samples);
    expect(capture.getSnapshot().level).toBeCloseTo(Math.min(1, rms * 8));
    expect(capture.getSnapshot().peak).toBeCloseTo(peak);
    // The same PCM frame the handler received feeds the meter.
    expect(frames[0]).toBe(samples);
  });

  it('stops forwarding frames when muted and resumes with the same stream', async () => {
    const { capture, emitWorkletFrame, frames, getUserMedia } = captureWithMocks();
    await capture.open({});
    emitWorkletFrame(new Float32Array(512).fill(0.25));
    expect(frames).toHaveLength(1);

    capture.setMuted(true);
    emitWorkletFrame(new Float32Array(512).fill(0.25));
    expect(frames).toHaveLength(1);
    expect(capture.getSnapshot()).toMatchObject({ status: 'muted' });

    capture.setMuted(false);
    emitWorkletFrame(new Float32Array(512).fill(0.25));
    expect(frames).toHaveLength(2);
    // Unmuting must never open a parallel MediaStream.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('releases the whole capture lifecycle on close and stays idempotent', async () => {
    const { capture, streams, close, source, emitWorkletFrame } = captureWithMocks();
    await capture.open({});
    emitWorkletFrame(new Float32Array(512).fill(0.1));

    await capture.close();
    await capture.close();

    expect(streams[0]!.stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(source.disconnect).toHaveBeenCalled();
    expect(capture.getSnapshot()).toMatchObject({ status: 'closed', level: 0 });
  });
});
