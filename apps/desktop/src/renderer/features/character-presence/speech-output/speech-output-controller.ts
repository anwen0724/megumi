/*
 * Renderer-side speech output playback controller. Consumes the validated
 * Speech Output Event stream, decodes the streaming mp3 chunks, and schedules
 * them on a Web Audio context routed to the configured output device.
 * Chunk decoding is tolerant: partial mp3 frames accumulate until they
 * decode, so provider chunking never loses audio.
 */

import type { SpeechOutputEvent } from '@megumi/voice';

export type SpeechOutputViewStatus = 'idle' | 'playing' | 'error';

export interface SpeechOutputViewSnapshot {
  readonly status: SpeechOutputViewStatus;
  /** Neutral failure code for i18n mapping; raw supplier text stays out of the UI. */
  readonly errorCode?: string;
  /** Diagnostic detail for logs only; never rendered directly. */
  readonly errorMessage?: string;
}

export interface SpeechOutputAudioContext {
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  setSinkId?(sinkId: string): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<SpeechOutputAudioBuffer>;
  createBufferSource(): SpeechOutputBufferSource;
}

export interface SpeechOutputAudioBuffer {
  readonly duration: number;
}

export interface SpeechOutputBufferSource {
  buffer: SpeechOutputAudioBuffer | null;
  connect(destination: unknown): void;
  start(when: number): void;
  stop(): void;
  onended: (() => void) | null;
}

export interface SpeechOutputControllerOptions {
  /** Subscribes to validated Speech Output Events from the Preload bridge. */
  readonly onEvent: (subscriber: (event: SpeechOutputEvent) => void) => () => void;
  /** Resolves the configured output device id ('default' for system default). */
  readonly resolveOutputDeviceId: () => Promise<string>;
  readonly createAudioContext?: () => SpeechOutputAudioContext;
}

export interface SpeechOutputController {
  getSnapshot(): SpeechOutputViewSnapshot;
  subscribe(listener: (snapshot: SpeechOutputViewSnapshot) => void): { unsubscribe(): void };
  /** Stops local playback; used when the character window hides. */
  stopLocal(): void;
  dispose(): void;
}

export function createSpeechOutputController(
  options: SpeechOutputControllerOptions,
): SpeechOutputController {
  const listeners = new Set<(snapshot: SpeechOutputViewSnapshot) => void>();
  let snapshot: SpeechOutputViewSnapshot = { status: 'idle' };
  let context: SpeechOutputAudioContext | undefined;
  let contextPromise: Promise<SpeechOutputAudioContext> | undefined;
  let contextClosed = false;
  let pending: Uint8Array | undefined;
  let scheduledEnd = 0;
  let decodedAny = false;
  let completed = false;
  let runToken = 0;
  let chunkChain: Promise<void> = Promise.resolve();
  const activeSources = new Set<SpeechOutputBufferSource>();

  const publish = (next: SpeechOutputViewSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  const createContext = (): SpeechOutputAudioContext =>
    options.createAudioContext ? options.createAudioContext() : new AudioContext() as unknown as SpeechOutputAudioContext;

  const ensureContext = async (): Promise<SpeechOutputAudioContext | undefined> => {
    if (contextClosed) return undefined;
    if (context) return context;
    contextPromise ??= (async () => {
      const next = createContext();
      try {
        await next.resume();
        const deviceId = await options.resolveOutputDeviceId();
        if (next.setSinkId) {
          try {
            await next.setSinkId(deviceId);
          } catch {
            // Unavailable device falls back to the system default (D16).
          }
        }
      } catch {
        // Context creation or device resolution failing must not break the chain.
      }
      return next;
    })();
    context = await contextPromise;
    return context;
  };

  const stopSources = () => {
    ++runToken; // invalidates in-flight decodes and queued chunk work
    for (const source of activeSources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // An already-ended source must not escalate.
      }
    }
    activeSources.clear();
    pending = undefined;
    scheduledEnd = 0;
    completed = false;
    decodedAny = false;
  };

  const schedule = (buffer: SpeechOutputAudioBuffer, target: SpeechOutputAudioContext) => {
    const source = target.createBufferSource();
    source.buffer = buffer;
    source.connect(target.destination);
    activeSources.add(source);
    source.onended = () => {
      activeSources.delete(source);
      if (completed && activeSources.size === 0) publish({ status: 'idle' });
    };
    const when = Math.max(target.currentTime, scheduledEnd);
    source.start(when);
    scheduledEnd = when + buffer.duration;
  };

  const handleChunk = (bytes: Uint8Array, token: number) => {
    // Serialize chunk processing: concurrent async decodes raced on the
    // shared pending buffer and scheduled overlapping audio twice.
    chunkChain = chunkChain.then(() => processChunk(bytes, token)).catch(() => undefined);
  };

  const processChunk = async (bytes: Uint8Array, token: number) => {
    if (token !== runToken) return;
    const target = await ensureContext();
    if (!target || token !== runToken) return;
    pending = pending ? concatBytes(pending, bytes) : bytes;
    try {
      const copy = pending.slice();
      const buffer = await target.decodeAudioData(copy.buffer as ArrayBuffer);
      if (token !== runToken) return; // stale decode after a stop or replacement
      pending = undefined;
      decodedAny = true;
      schedule(buffer, target);
    } catch {
      // Partial mp3 frame: keep accumulating until the next chunk decodes.
    }
  };

  const handleEvent = (event: SpeechOutputEvent) => {
    if (event.type === 'synthesis-started') {
      stopSources();
      completed = false;
      publish({ status: 'playing' });
      return;
    }
    if (event.type === 'audio-chunk') {
      void handleChunk(event.bytes, runToken);
      return;
    }
    if (event.type === 'completed') {
      completed = true;
      if (pending && !decodedAny) {
        // Nothing decoded for the whole run: surface an honest failure.
        stopSources();
        publish({ status: 'error', errorCode: 'voice_tts_decode_failed', errorMessage: 'Audio could not be decoded.' });
        return;
      }
      pending = undefined;
      if (activeSources.size === 0) publish({ status: 'idle' });
      return;
    }
    if (event.type === 'stopped') {
      stopSources();
      publish({ status: 'idle' });
      return;
    }
    stopSources();
    publish({ status: 'error', errorCode: event.failure.code, errorMessage: event.failure.message });
  };

  const unsubscribeEvents = options.onEvent(handleEvent);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    stopLocal() {
      stopSources();
      publish({ status: 'idle' });
    },
    dispose() {
      unsubscribeEvents();
      stopSources();
      listeners.clear();
      contextClosed = true;
      if (context) void context.close().catch(() => undefined);
    },
  };
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}
