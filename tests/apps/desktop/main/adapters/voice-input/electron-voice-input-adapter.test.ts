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

describe('Electron voice input adapter startup failures', () => {
  it('converts a synchronous worker spawn failure into a structured start failure', async () => {
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => {
        throw new Error('Worker entry file is missing.');
      },
    });

    await expect(adapter.start({ generation: 1 })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'voice_worker_start_failed', message: 'Worker entry file is missing.' },
    });
    expect(adapter.getGeneration()).toBeUndefined();
  });

  it('ends the readiness wait immediately when the worker errors before ready', async () => {
    const worker = new FakeWorker();
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => worker,
      startTimeoutMs: 60_000,
    });

    const starting = adapter.start({ generation: 1 });
    worker.emit('error', new Error('Native module failed to load.'));

    await expect(starting).resolves.toEqual({
      status: 'failed',
      failure: expect.objectContaining({ code: 'voice_worker_exited', message: 'Native module failed to load.' }),
    });
    expect(adapter.getGeneration()).toBeUndefined();
  });

  it('ends the readiness wait immediately when the worker exits before ready', async () => {
    const worker = new FakeWorker();
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => worker,
      startTimeoutMs: 60_000,
    });

    const starting = adapter.start({ generation: 1 });
    worker.emit('exit', 1);

    await expect(starting).resolves.toEqual({
      status: 'failed',
      failure: expect.objectContaining({ code: 'voice_worker_exited' }),
    });
  });

  it('allows a fresh start after an async startup failure', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => workers.shift()!,
    });

    const failed = adapter.start({ generation: 1 });
    first.emit('exit', 1);
    await expect(failed).resolves.toMatchObject({ status: 'failed' });

    const restarting = adapter.start({ generation: 2 });
    second.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 2 } });
    await expect(restarting).resolves.toEqual({ status: 'started', generation: 2 });
  });
});

describe('Electron voice input adapter frame backpressure', () => {
  interface CreditPort {
    frames: Array<{ generation: number; sequence: number; samples: Float32Array }>;
    credits: number;
    closed: boolean;
    listener?: (frame: { generation: number; sequence: number; sampleRate: 16000; samples: Float32Array }) => void;
  }

  function creditPort(): CreditPort {
    return { frames: [], credits: 0, closed: false };
  }

  function attachPort(adapter: ElectronVoiceInputAdapter, port: CreditPort) {
    adapter.attachFramePort({
      onMessage(listener) { port.listener = listener; },
      postMessage(message) { port.credits += message.count; },
      close() { port.closed = true; },
    });
  }

  it('releases one credit per worker-acked frame and transfers the PCM buffer', async () => {
    const worker = new FakeWorker();
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => worker,
    });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;
    const port = creditPort();
    attachPort(adapter, port);

    const first = frame(1, 0);
    const second = frame(1, 1);
    port.listener!({ generation: 1, sequence: 0, sampleRate: 16_000, samples: first.samples });
    port.listener!({ generation: 1, sequence: 1, sampleRate: 16_000, samples: second.samples });

    const sent = worker.posted.filter((entry) => entry.value.type === 'frame');
    expect(sent).toHaveLength(1); // ack-gated: only one in flight
    expect(sent[0]!.transfer).toEqual([first.samples.buffer]);

    worker.emitMessage({ type: 'frame-ack', generation: 1, sequence: 0 });
    expect(port.credits).toBe(1);
    expect(worker.posted.filter((entry) => entry.value.type === 'frame')).toHaveLength(2);
    worker.emitMessage({ type: 'frame-ack', generation: 1, sequence: 1 });
    expect(port.credits).toBe(2);
  });

  it('returns credits for frames dropped by stale generations or invalid shapes', async () => {
    const worker = new FakeWorker();
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => worker,
    });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;
    const port = creditPort();
    attachPort(adapter, port);

    port.listener!({ generation: 99, sequence: 0, sampleRate: 16_000, samples: new Float32Array(512) });
    port.listener!({ generation: 1, sequence: 1, sampleRate: 16_000, samples: new Float32Array(256) });
    expect(port.credits).toBe(2);
    expect(worker.posted.filter((entry) => entry.value.type === 'frame')).toHaveLength(0);
  });

  it('releases credits for the cleared backlog on overflow and keeps the microphone running', async () => {
    const worker = new FakeWorker();
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => worker,
      maxPendingFrames: 8,
    });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;
    const port = creditPort();
    attachPort(adapter, port);

    // The worker never acks; the queue fills to the cap and overflows.
    for (let sequence = 0; sequence < 12; sequence += 1) {
      port.listener!({ generation: 1, sequence, sampleRate: 16_000, samples: new Float32Array(512) });
    }

    const overflow = worker.posted.find((entry) => entry.value.type === 'overflow');
    expect(overflow?.value).toEqual({ type: 'overflow', generation: 1 });
    // One frame in flight plus the 8-frame cap never exceeded.
    expect(worker.posted.filter((entry) => entry.value.type === 'frame')).toHaveLength(1);
    // Dropped backlog frames returned their credits so the Renderer proceeds.
    expect(port.credits).toBeGreaterThan(0);
    // The worker is still alive: no stop/dispose happened.
    expect(worker.terminated).toBe(false);
  });

  it('closes the frame port on stop and dispose', async () => {
    const worker = new FakeWorker();
    const adapter = createElectronVoiceInputAdapter({
      resolveResourcePaths: () => ({
        vadModelPath: 'C:/resources/vad/silero_vad.onnx',
        senseVoiceModelPath: 'C:/models/model.int8.onnx',
        senseVoiceTokensPath: 'C:/models/tokens.txt',
      }),
      workerEntryPath: 'C:/repo/.vite/build/voice-input-worker.js',
      createWorker: () => worker,
    });
    const starting = adapter.start({ generation: 1 });
    worker.emitMessage({ type: 'event', event: { type: 'runtime-ready', generation: 1 } });
    await starting;
    const port = creditPort();
    attachPort(adapter, port);

    const stopping = adapter.stop({ generation: 1, reason: 'user' });
    worker.emitMessage({ type: 'event', event: { type: 'stopped', generation: 1 } });
    await stopping;
    expect(port.closed).toBe(true);
  });
});
