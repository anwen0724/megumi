/* Manages the bundled MOSS-TTS-Nano process and its newline-delimited streaming protocol. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import type { SpeechPcm, SpeechVoiceSource } from './speech';

export const MOSS_SIDECAR_PROTOCOL_VERSION = 2;

export function validateMossSidecarReadyMessage(message: Record<string, unknown>): void {
  if (message.protocolVersion !== MOSS_SIDECAR_PROTOCOL_VERSION) {
    throw new Error(
      `MOSS sidecar protocol version mismatch: expected ${MOSS_SIDECAR_PROTOCOL_VERSION}, received ${String(message.protocolVersion ?? 'legacy')}.`,
    );
  }
}

export interface MossSynthesisRequest {
  readonly synthesisId: string;
  readonly modelPath: string;
  readonly cachePath: string;
  readonly text: string;
  readonly voice: SpeechVoiceSource;
  readonly signal?: AbortSignal;
}

export interface MossPreparationRequest {
  readonly preparationId: string;
  readonly modelPath: string;
  readonly cachePath: string;
  readonly voice: SpeechVoiceSource;
  readonly signal?: AbortSignal;
}

export interface MossSidecarClient {
  prepare(request: MossPreparationRequest): Promise<void>;
  synthesize(request: MossSynthesisRequest): AsyncIterable<SpeechPcm>;
  dispose(): Promise<void>;
}

interface PendingSynthesis {
  readonly chunks: SpeechPcm[];
  readonly waiters: Array<() => void>;
  done: boolean;
  error?: Error;
}

interface PendingPreparation {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export function createMossSidecarClient(options: {
  readonly executablePath: string;
  readonly startupTimeoutMs?: number;
}): MossSidecarClient {
  let process: ChildProcessWithoutNullStreams | undefined;
  let readyPromise: Promise<void> | undefined;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const pending = new Map<string, PendingSynthesis>();
  const pendingPreparations = new Map<string, PendingPreparation>();

  const ensureStarted = async () => {
    if (!process) {
      process = spawn(options.executablePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      readyPromise = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const lines = readline.createInterface({ input: process.stdout });
      lines.on('line', (line) => handleMessage(line));
      process.once('error', (error) => failProcess(error));
      process.once('exit', (code, signal) => {
        failProcess(new Error(`MOSS sidecar exited (${code ?? signal ?? 'unknown'}).`));
        process = undefined;
      });
      process.stdin.write(`${JSON.stringify({ type: 'health' })}\n`);
    }
    const timeoutMs = options.startupTimeoutMs ?? 30_000;
    await Promise.race([
      readyPromise,
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('MOSS sidecar startup timed out.')),
        timeoutMs,
      )),
    ]);
  };

  const handleMessage = (line: string) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === 'ready') {
      try {
        validateMossSidecarReadyMessage(message);
      } catch (error) {
        rejectReady?.(error instanceof Error ? error : new Error(String(error)));
        resolveReady = undefined;
        rejectReady = undefined;
        process?.kill();
        return;
      }
      resolveReady?.();
      resolveReady = undefined;
      rejectReady = undefined;
      return;
    }
    if (typeof message.preparationId === 'string') {
      const preparation = pendingPreparations.get(message.preparationId);
      if (!preparation) return;
      pendingPreparations.delete(message.preparationId);
      if (message.type === 'prepared') preparation.resolve();
      else if (message.type === 'prepare_error') {
        preparation.reject(new Error(
          typeof message.message === 'string' ? message.message : 'MOSS preparation failed.',
        ));
      }
      return;
    }
    if (typeof message.synthesisId !== 'string') return;
    const active = pending.get(message.synthesisId);
    if (!active) return;
    if (message.type === 'chunk' && typeof message.samplesBase64 === 'string' && typeof message.sampleRate === 'number') {
      const bytes = Buffer.from(message.samplesBase64, 'base64');
      const copied = Uint8Array.from(bytes);
      active.chunks.push({
        samples: new Float32Array(copied.buffer),
        sampleRate: message.sampleRate,
        channels: 1,
      });
    } else if (message.type === 'complete') {
      active.done = true;
    } else if (message.type === 'error') {
      active.error = new Error(typeof message.message === 'string' ? message.message : 'MOSS synthesis failed.');
      active.done = true;
    }
    wake(active);
  };

  const failProcess = (error: Error) => {
    rejectReady?.(error);
    rejectReady = undefined;
    for (const active of pending.values()) {
      active.error = error;
      active.done = true;
      wake(active);
    }
    for (const preparation of pendingPreparations.values()) preparation.reject(error);
    pendingPreparations.clear();
  };

  return {
    async prepare(request) {
      await ensureStarted();
      if (!process) throw new Error('MOSS sidecar is unavailable.');
      if (request.signal?.aborted) throw new Error('MOSS preparation was cancelled.');
      const preparation = new Promise<void>((resolve, reject) => {
        pendingPreparations.set(request.preparationId, { resolve, reject });
      });
      const onAbort = () => process?.stdin.write(`${JSON.stringify({
        type: 'cancel',
        preparationId: request.preparationId,
      })}\n`);
      request.signal?.addEventListener('abort', onAbort, { once: true });
      process.stdin.write(`${JSON.stringify({
        type: 'prepare',
        preparationId: request.preparationId,
        modelPath: request.modelPath,
        cachePath: request.cachePath,
        voice: request.voice,
      })}\n`);
      try {
        await preparation;
      } finally {
        request.signal?.removeEventListener('abort', onAbort);
        pendingPreparations.delete(request.preparationId);
      }
    },
    async *synthesize(request) {
      await ensureStarted();
      if (!process) throw new Error('MOSS sidecar is unavailable.');
      const active: PendingSynthesis = { chunks: [], waiters: [], done: false };
      pending.set(request.synthesisId, active);
      const onAbort = () => process?.stdin.write(`${JSON.stringify({
        type: 'cancel',
        synthesisId: request.synthesisId,
      })}\n`);
      request.signal?.addEventListener('abort', onAbort, { once: true });
      process.stdin.write(`${JSON.stringify({
        type: 'synthesize',
        synthesisId: request.synthesisId,
        modelPath: request.modelPath,
        cachePath: request.cachePath,
        text: request.text,
        voice: request.voice,
      })}\n`);
      try {
        while (!active.done || active.chunks.length > 0) {
          if (active.chunks.length === 0) await waitForMessage(active);
          if (active.error) throw active.error;
          const chunk = active.chunks.shift();
          if (chunk) yield chunk;
        }
      } finally {
        request.signal?.removeEventListener('abort', onAbort);
        pending.delete(request.synthesisId);
      }
    },
    async dispose() {
      if (!process) return;
      const activeProcess = process;
      activeProcess.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`);
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          activeProcess.kill();
          resolve();
        }, 2_000);
        activeProcess.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      process = undefined;
    },
  };
}

function wake(active: PendingSynthesis): void {
  for (const waiter of active.waiters.splice(0)) waiter();
}

function waitForMessage(active: PendingSynthesis): Promise<void> {
  if (active.done || active.chunks.length > 0) return Promise.resolve();
  return new Promise((resolve) => active.waiters.push(resolve));
}
