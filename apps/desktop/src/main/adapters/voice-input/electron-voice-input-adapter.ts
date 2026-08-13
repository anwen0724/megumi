/*
 * Desktop host adapter that runs the packages/voice Speech Input Runtime in a
 * Node Speech Worker. Owns the worker lifecycle, the bounded pending-frame
 * queue with ack gating, transfer of PCM ArrayBuffers, Speech Input Event
 * projection, and packaged/dev resource path resolution. It implements the
 * SpeechInputRuntime contract but never re-implements VAD/utterance/STT rules.
 *
 * Frame backpressure: the Renderer sends frames over a dedicated MessagePort
 * and pays one credit per frame; the Adapter releases a credit only when the
 * Worker acks the frame or when the Adapter drops it (stale generation,
 * overflow, shutdown). The whole chain therefore has a fixed maximum number
 * of in-flight frames and no invisible unbounded queue.
 */

import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  SpeechInputEvent,
  SpeechInputGenerationRequest,
  SpeechInputRuntime,
  SetSpeechInputMutedRequest,
  StartSpeechInputRequest,
  StartSpeechInputResult,
  StopSpeechInputRequest,
} from '@megumi/voice';
import { VOICE_INPUT_MAX_IN_FLIGHT_FRAMES } from '@megumi/voice/speech-input/voice-input-capacity';
import {
  parseVoiceInputWorkerResponse,
  type VoiceInputWorkerData,
  type VoiceInputWorkerRequest,
  type VoiceInputWorkerResponse,
} from './voice-input-worker-protocol';

export interface VoiceInputResourcePaths {
  readonly vadModelPath: string;
  readonly senseVoiceModelPath: string;
  readonly senseVoiceTokensPath: string;
}

export interface VoiceInputWorker {
  postMessage(value: VoiceInputWorkerRequest, transferList?: readonly ArrayBuffer[]): void;
  on(event: 'message', listener: (response: unknown) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  terminate(): Promise<number> | void;
}

/** One validated 512-sample frame arriving from the Renderer frame port. */
export interface VoiceInputFrameMessage {
  readonly generation: number;
  readonly sequence: number;
  readonly sampleRate: 16000;
  readonly samples: Float32Array;
}

/** Main-side handle of the Renderer frame MessagePort. */
export interface FramePortLike {
  onMessage(listener: (frame: VoiceInputFrameMessage) => void): void;
  postMessage(message: { readonly type: 'credit'; readonly count: number }): void;
  close(): void;
}

export interface CreateElectronVoiceInputAdapterOptions {
  readonly resolveResourcePaths: () => VoiceInputResourcePaths;
  /** Resolved by Desktop Composition via resolveVoiceInputWorkerEntryPath. */
  readonly workerEntryPath: string;
  /** @internal Test seam; production spawns a worker_threads Worker. */
  readonly createWorker?: (entryPath: string, workerData: VoiceInputWorkerData) => VoiceInputWorker;
  readonly maxPendingFrames?: number;
  readonly startTimeoutMs?: number;
}

export interface ElectronVoiceInputAdapter extends SpeechInputRuntime {
  getGeneration(): number | undefined;
  /** Attaches the dedicated Renderer frame port; replaces any previous one. */
  attachFramePort(port: FramePortLike): void;
  dispose(): Promise<void>;
}

const DEFAULT_START_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;

export function createElectronVoiceInputAdapter(
  options: CreateElectronVoiceInputAdapterOptions,
): ElectronVoiceInputAdapter {
  const maxPendingFrames = options.maxPendingFrames ?? VOICE_INPUT_MAX_IN_FLIGHT_FRAMES;
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const listeners = new Set<(event: SpeechInputEvent) => void>();
  let generation: number | undefined;
  let nextGeneration = 0;
  let worker: VoiceInputWorker | undefined;
  let waiting: Array<{ generation: number; sequence: number; samples: Float32Array; buffer: ArrayBuffer }> = [];
  let inFlight: { generation: number; sequence: number } | undefined;
  let framePort: FramePortLike | undefined;
  let disposed = false;

  const emit = (event: SpeechInputEvent) => {
    for (const listener of listeners) listener(event);
  };

  const subscribe: SpeechInputRuntime['subscribe'] = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const clearRun = () => {
    worker = undefined;
    generation = undefined;
    inFlight = undefined;
    waiting = [];
    if (framePort) {
      framePort.close();
      framePort = undefined;
    }
  };

  const failWorker = (message: string) => {
    const failedGeneration = generation;
    clearRun();
    if (failedGeneration !== undefined) {
      emit({
        type: 'runtime-failed',
        generation: failedGeneration,
        failure: { code: 'voice_worker_exited', message },
      });
    }
  };

  /** One credit per frame the Worker confirmed; the Renderer never re-sends. */
  const releaseCredit = (count: number) => {
    if (count <= 0 || !framePort) return;
    framePort.postMessage({ type: 'credit', count });
  };

  const sendNextFrame = () => {
    if (inFlight || !worker) return;
    const next = waiting.shift();
    if (!next) return;
    inFlight = { generation: next.generation, sequence: next.sequence };
    worker.postMessage(
      { type: 'frame', generation: next.generation, sequence: next.sequence, samples: next.samples },
      [next.buffer],
    );
  };

  /** Shared entry for the Renderer frame port and the direct SpeechInputRuntime call. */
  const enqueueFrame = (frame: VoiceInputFrameMessage) => {
    if (!worker || generation === undefined || frame.generation !== generation) {
      // Taken over and discarded: return the credit so the Renderer can proceed.
      releaseCredit(1);
      return;
    }
    if (frame.sampleRate !== 16_000 || frame.samples.length !== 512) {
      releaseCredit(1);
      return;
    }
    if (waiting.length >= maxPendingFrames) {
      // QUEUE-03/04: drop the unprocessed backlog and tell the worker to
      // discard the in-progress utterance; the microphone stays open.
      const dropped = waiting.length;
      waiting = [];
      releaseCredit(dropped);
      worker.postMessage({ type: 'overflow', generation });
    }
    waiting.push({
      generation: frame.generation,
      sequence: frame.sequence,
      samples: frame.samples,
      buffer: frame.samples.buffer as ArrayBuffer,
    });
    sendNextFrame();
  };

  const spawnWorker = (): VoiceInputWorker => {
    const workerData: VoiceInputWorkerData = options.resolveResourcePaths();
    const created = options.createWorker
      ? options.createWorker(options.workerEntryPath, workerData)
      : spawnNodeSpeechWorker(options.workerEntryPath, workerData);
    created.on('message', (rawResponse: unknown) => {
      const response: VoiceInputWorkerResponse | undefined = parseVoiceInputWorkerResponse(rawResponse);
      if (!response) return;
      if (response.type === 'frame-ack') {
        if (inFlight?.sequence === response.sequence && generation === response.generation) {
          inFlight = undefined;
          releaseCredit(1);
          sendNextFrame();
        }
        return;
      }
      emit(response.event);
    });
    created.on('error', (error) => failWorker(error.message));
    created.on('exit', () => failWorker('The voice recognition worker exited unexpectedly.'));
    return created;
  };

  /** Waits for one matching event within the timeout; resolves undefined otherwise. */
  const awaitEvent = (
    predicate: (event: SpeechInputEvent) => boolean,
    timeoutMs: number,
  ): Promise<SpeechInputEvent | undefined> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(undefined);
      }, timeoutMs);
      const unsubscribe = subscribe((event) => {
        if (!predicate(event)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      });
    });

  const stopInternal = async (request: StopSpeechInputRequest): Promise<void> => {
    if (request.generation !== undefined && request.generation !== generation) return;
    const activeWorker = worker;
    const activeGeneration = generation;
    if (!activeWorker || activeGeneration === undefined) return;
    activeWorker.postMessage({ type: 'stop', generation: activeGeneration, reason: request.reason });
    await awaitEvent(
      (event) => event.type === 'stopped' && event.generation === activeGeneration,
      DEFAULT_STOP_TIMEOUT_MS,
    );
    clearRun();
    await activeWorker.terminate();
  };

  return {
    getGeneration: () => generation,
    attachFramePort(port) {
      if (framePort) framePort.close();
      framePort = port;
      port.onMessage(enqueueFrame);
    },
    async start(request: StartSpeechInputRequest): Promise<StartSpeechInputResult> {
      if (disposed) {
        return {
          status: 'failed',
          failure: { code: 'voice_input_disposed', message: 'The voice input adapter is disposed.' },
        };
      }
      if (worker && (request.generation === undefined || request.generation === generation)) {
        return { status: 'started', generation: generation! };
      }
      if (worker) {
        // Restarting with a new generation replaces the previous run.
        await stopInternal({ generation, reason: 'user' });
      }
      const activeGeneration = request.generation ?? ++nextGeneration;
      generation = activeGeneration;
      waiting = [];
      inFlight = undefined;
      let createdWorker: VoiceInputWorker;
      try {
        createdWorker = spawnWorker();
      } catch (error) {
        // A synchronous spawn failure is a structured start failure, not a
        // rejection or a stuck preparing state.
        const message = error instanceof Error ? error.message : String(error);
        generation = undefined;
        waiting = [];
        inFlight = undefined;
        return {
          status: 'failed',
          failure: { code: 'voice_worker_start_failed', message },
        };
      }
      worker = createdWorker;
      createdWorker.postMessage({ type: 'start', generation: activeGeneration, language: request.language });

      // The readiness wait ends on runtime-ready, but ALSO immediately on a
      // worker error, exit, or runtime-failed event: the real failure is
      // returned instead of a rewritten timeout.
      const outcome = await new Promise<StartSpeechInputResult>((resolve) => {
        const timer = setTimeout(() => {
          unsubscribe();
          const stillCurrent = worker === createdWorker && generation === activeGeneration;
          if (stillCurrent) {
            clearRun();
            emit({
              type: 'runtime-failed',
              generation: activeGeneration,
              failure: {
                code: 'voice_worker_start_timeout',
                message: 'The voice recognition worker did not become ready in time.',
              },
            });
          }
          void createdWorker.terminate();
          resolve({
            status: 'failed',
            failure: {
              code: 'voice_worker_start_timeout',
              message: 'The voice recognition worker did not become ready in time.',
            },
          });
        }, startTimeoutMs);
        const unsubscribe = subscribe((event) => {
          if (event.type === 'runtime-ready' && event.generation === activeGeneration) {
            clearTimeout(timer);
            unsubscribe();
            resolve({ status: 'started', generation: activeGeneration });
            return;
          }
          if (event.type === 'runtime-failed' && event.generation === activeGeneration) {
            clearTimeout(timer);
            unsubscribe();
            void createdWorker.terminate();
            resolve({ status: 'failed', failure: event.failure });
          }
        });
      });
      return outcome;
    },
    acceptFrame(frame) {
      enqueueFrame({
        generation: frame.generation,
        sequence: frame.sequence,
        sampleRate: frame.sampleRate,
        samples: frame.samples,
      });
    },
    setMuted(request: SetSpeechInputMutedRequest) {
      if (!worker || generation === undefined) return;
      worker.postMessage({ type: 'mute', muted: request.muted });
    },
    startManualUtterance(request: SpeechInputGenerationRequest) {
      if (!worker || request.generation !== generation) return;
      worker.postMessage({ type: 'manual-start', generation: request.generation });
    },
    finishManualUtterance(request: SpeechInputGenerationRequest) {
      if (!worker || request.generation !== generation) return;
      worker.postMessage({ type: 'manual-finish', generation: request.generation });
    },
    async stop(request: StopSpeechInputRequest) {
      await stopInternal(request);
    },
    subscribe,
    async dispose() {
      disposed = true;
      if (worker) {
        const activeWorker = worker;
        clearRun();
        await activeWorker.terminate();
      } else {
        clearRun();
      }
      listeners.clear();
    },
  };
}

/** Resolves the packaged or development worker bundle entry. */
export function resolveVoiceInputWorkerEntryPath(input: {
  readonly isPackaged: boolean;
  readonly cwd: string;
  readonly mainBuildDirectory?: string;
}): string {
  if (input.isPackaged) {
    const buildDirectory = input.mainBuildDirectory ?? path.join(input.cwd, '.vite', 'build');
    return path.join(buildDirectory, 'voice-input-worker.js');
  }
  return path.resolve(input.cwd, '.vite/build/voice-input-worker.js');
}

function spawnNodeSpeechWorker(entryPath: string, workerData: VoiceInputWorkerData): VoiceInputWorker {
  // worker_threads lives inside this host adapter module; packages/voice stays
  // free of Node threading concerns.
  const created = new Worker(entryPath, { workerData });
  return {
    postMessage: (value, transferList) => created.postMessage(value, transferList),
    on: (event, listener) => created.on(event, listener as never),
    terminate: () => created.terminate(),
  };
}
