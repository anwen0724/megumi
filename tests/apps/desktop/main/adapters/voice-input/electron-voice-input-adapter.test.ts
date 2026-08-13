// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createElectronVoiceInputAdapter,
  type ElectronVoiceInputAdapter,
} from '@megumi/desktop/main/adapters/voice-input/electron-voice-input-adapter';
import type {
  VoiceInputWorkerData,
  VoiceInputWorkerRequest,
  VoiceInputWorkerResponse,
} from '@megumi/desktop/main/adapters/voice-input/voice-input-worker-protocol';
import type { SpeechInputEvent } from '@megumi/voice';

type Listener = (...args: never[]) => void;

class FakeWorker {
  readonly posted: Array<{ value: VoiceInputWorkerRequest; transfer?: Transferable[] }> = [];
  readonly listeners = new Map<string, Set<Listener>>();
  terminated = false;
  terminateCount = 0;
  lastWorkerData: VoiceInputWorkerData | undefined;

  constructor(workerData?: VoiceInputWorkerData) {
    this.lastWorkerData = workerData;
  }

  postMessage(value: VoiceInputWorkerRequest, transfer?: Transferable[]): void {
    this.posted.push({ value, transfer });
  }

  on(event: string, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...values: unknown[]) => void)(...args);
    }
  }

  emitMessage(response: VoiceInputWorkerResponse): void {
    this.emit('message', response);
  }

  terminate(): Promise<number> {
    this.terminated = true;
    this.terminateCount += 1;
    return Promise.resolve(0);
  }
}

function createAdapter(options: { worker?: FakeWorker } = {}) {
  const workers: FakeWorker[] = [];
  const events: SpeechInputEvent[] = [];
  let lastWorkerData: VoiceInputWorkerData | undefined;
  const adapter = createElectronVoiceInputAdapter({
    resolveResourcePaths: () => ({
      vadModelPath: 'C:/resources/vad/silero_vad.onnx',
      senseVoiceModelPath: 'C:/models/model.int8.onnx',
      senseVoiceTokensPath: 'C:/models/tokens.txt',
    }),
    workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
    createWorker: (_entryPath, workerData) => {
      lastWorkerData = workerData;
      const worker = options.worker ?? new FakeWorker(workerData);
      workers.push(worker);
      return worker;
    },
  });
  adapter.subscribe((event) => events.push(event));
  return { adapter, workers, events, getLastWorkerData: () => lastWorkerData };
}

function frame(generation: number, sequence: number): { generation: number; sequence: number; sampleRate: 16000; samples: Float32Array } {
  return {
    generation,
    sequence,
    sampleRate: 16_000,
    samples: new Float32Array(512).fill(0.1),
  };
}

describe('Electron voice input adapter', () => {
  it('spawns exactly one worker per start and resolves with the allocated generation', async () => {
    const worker = new FakeWorker();
    const { adapter, workers, getLastWorkerData } = createAdapter({ worker });
    const starting = adapter.start({ language: 'zh' });

    // The worker confirms readiness with a runtime-ready event.
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await expect(starting).resolves.toEqual({ status: 'started', generation: 1 });

    expect(workers).toHaveLength(1);
    expect(getLastWorkerData()).toEqual({
      vadModelPath: 'C:/resources/vad/silero_vad.onnx',
      senseVoiceModelPath: 'C:/models/model.int8.onnx',
      senseVoiceTokensPath: 'C:/models/tokens.txt',
    });
    expect(worker.posted[0]!.value).toEqual({ type: 'start', generation: 1, language: 'zh' });
    expect(adapter.getGeneration()).toBe(1);

    // Starting again with the same generation reuses the running worker.
    await adapter.start({ generation: 1 });
    expect(workers).toHaveLength(1);
  });

  it('replaces the worker when restarting with a new generation', async () => {
    const { adapter, workers } = createAdapter();
    const starting = adapter.start({ generation: 1 });
    workers[0]!.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;

    const restarting = adapter.start({ generation: 2 });
    // The old run is stopped before the new worker appears.
    workers[0]!.emitMessage({ type: 'event', event: { type: 'stopped', generation: 1 } });
    await vi.waitFor(() => {
      expect(workers[0]!.terminated).toBe(true);
    });
    await vi.waitFor(() => {
      expect(workers).toHaveLength(2);
    });
    workers[1]!.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 2 } });
    await expect(restarting).resolves.toEqual({ status: 'started', generation: 2 });
    expect(workers).toHaveLength(2);
  });

  it('forwards one frame at a time and waits for the frame ack', async () => {
    const worker = new FakeWorker();
    const { adapter, workers } = createAdapter({ worker });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;

    const first = frame(1, 0);
    adapter.acceptFrame(first);
    adapter.acceptFrame(frame(1, 1));
    adapter.acceptFrame(frame(1, 2));

    // QUEUE-01: only one frame is in flight until the worker acks it.
    expect(worker.posted.filter((entry) => entry.value.type === 'frame')).toHaveLength(1);
    const sent = worker.posted.find((entry) => entry.value.type === 'frame')!;
    expect(sent.value).toMatchObject({ type: 'frame', generation: 1, sequence: 0 });
    expect(sent.transfer).toEqual([first.samples.buffer]);

    worker.emitMessage({ type: 'frame-ack', generation: 1, sequence: 0 });
    expect(worker.posted.filter((entry) => entry.value.type === 'frame')).toHaveLength(2);
    worker.emitMessage({ type: 'frame-ack', generation: 1, sequence: 1 });
    expect(worker.posted.filter((entry) => entry.value.type === 'frame')).toHaveLength(3);
  });

  it('caps the pending frame queue at 32 and overflows instead of growing', async () => {
    const worker = new FakeWorker();
    const { adapter } = createAdapter({ worker });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;

    for (let sequence = 0; sequence < 40; sequence += 1) {
      adapter.acceptFrame(frame(1, sequence));
    }

    // One frame in flight plus at most 32 waiting; the overflow resets the queue.
    expect(worker.posted.filter((entry) => entry.value.type === 'frame').length).toBeLessThanOrEqual(33);
    const overflow = worker.posted.find((entry) => entry.value.type === 'overflow');
    expect(overflow?.value).toEqual({ type: 'overflow', generation: 1 });

    // Recovery: acks drain the in-flight frame and the queue continues normally.
    worker.emitMessage({ type: 'frame-ack', generation: 1, sequence: 0 });
    const frameMessages = worker.posted.filter((entry) => entry.value.type === 'frame');
    expect(frameMessages.length).toBeGreaterThanOrEqual(1);
  });

  it('drops frames from older generations and frames while not started', async () => {
    const worker = new FakeWorker();
    const { adapter } = createAdapter({ worker });

    adapter.acceptFrame(frame(0, 0));
    expect(worker.posted).toHaveLength(0);

    const starting = adapter.start({ generation: 2 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 2 } });
    await starting;

    adapter.acceptFrame(frame(1, 0));
    adapter.acceptFrame(frame(2, 0));
    const sent = worker.posted.filter((entry) => entry.value.type === 'frame');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.value).toMatchObject({ generation: 2, sequence: 0 });
  });

  it('projects worker events to subscribers', async () => {
    const worker = new FakeWorker();
    const { adapter, events } = createAdapter({ worker });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;

    const transcriptEvent: SpeechInputEvent = {
      type: 'final-transcript',
      generation: 1,
      transcript: {
        generation: 1,
        utteranceId: 'utterance:1',
        text: '你好',
        startedAt: 0,
        endedAt: 100,
      },
    };
    worker.emitMessage({ type: 'event', event: transcriptEvent });

    expect(events).toContainEqual(transcriptEvent);
  });

  it('reports a bounded worker failure and allows a fresh start', async () => {
    const worker = new FakeWorker();
    const { adapter, events, workers } = createAdapter({ worker });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;

    worker.emit('exit', 1);

    expect(events).toContainEqual({
      type: 'runtime-failed',
      generation: 1,
      failure: expect.objectContaining({ code: 'voice_worker_exited' }),
    });
    // Frames for the dead generation are dropped.
    adapter.acceptFrame(frame(1, 0));
    expect(worker.posted.filter((entry) => entry.value.type === 'frame')).toHaveLength(0);

    // A fresh start spawns a fresh worker and recovers.
    const restarting = adapter.start({ generation: 2 });
    expect(workers).toHaveLength(2);
    workers[1]!.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 2 } });
    await expect(restarting).resolves.toEqual({ status: 'started', generation: 2 });
  });

  it('fails bounded by a start timeout when the worker never becomes ready', async () => {
    const worker = new FakeWorker();
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => worker,
      startTimeoutMs: 20,
    });

    await expect(adapter.start({ generation: 1 })).resolves.toEqual({
      status: 'failed',
      failure: expect.objectContaining({ code: 'voice_worker_start_timeout' }),
    });
    expect(worker.terminated).toBe(true);
  });

  it('stops the worker on stop after the stopped event and terminates it', async () => {
    const worker = new FakeWorker();
    const { adapter } = createAdapter({ worker });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;

    const stopping = adapter.stop({ generation: 1, reason: 'user' });
    expect(worker.posted.find((entry) => entry.value.type === 'stop')?.value)
      .toEqual({ type: 'stop', generation: 1, reason: 'user' });

    worker.emitMessage({ type: 'event', event: { type: 'stopped', generation: 1 } });
    await stopping;

    expect(worker.terminated).toBe(true);
    expect(adapter.getGeneration()).toBeUndefined();
  });

  it('ignores stop requests for stale generations and disposes unconditionally', async () => {
    const worker = new FakeWorker();
    const { adapter } = createAdapter({ worker });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;

    await adapter.stop({ generation: 99, reason: 'user' });
    expect(worker.terminated).toBe(false);

    await adapter.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('routes mute and manual boundary controls through the worker', async () => {
    const worker = new FakeWorker();
    const { adapter } = createAdapter({ worker });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;

    adapter.setMuted({ muted: true });
    adapter.startManualUtterance({ generation: 1 });
    adapter.finishManualUtterance({ generation: 1 });
    adapter.startManualUtterance({ generation: 3 });
    adapter.setMuted({ muted: false });

    expect(worker.posted.map((entry) => entry.value)).toEqual(expect.arrayContaining([
      { type: 'mute', muted: true },
      { type: 'manual-start', generation: 1 },
      { type: 'manual-finish', generation: 1 },
      { type: 'mute', muted: false },
    ]));
    expect(worker.posted.filter((entry) => entry.value.type === 'manual-start')).toHaveLength(1);
  });
});
