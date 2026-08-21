/* Verifies the renderer speech-output playback controller semantics. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createSpeechOutputController,
  type SpeechOutputAudioBuffer,
  type SpeechOutputAudioContext,
  type SpeechOutputBufferSource,
} from '@megumi/desktop/renderer/features/character-presence/speech-output/speech-output-controller';
import type { SpeechOutputEvent } from '@megumi/voice';

class FakeSource implements SpeechOutputBufferSource {
  buffer: SpeechOutputAudioBuffer | null = null;
  startedAt: number | undefined;
  stopped = false;
  onended: (() => void) | null = null;

  connect(): void {}
  start(when: number): void { this.startedAt = when; }
  stop(): void { this.stopped = true; this.onended?.(); }
}

class FakeContext implements SpeechOutputAudioContext {
  currentTime = 10;
  destination = {};
  sinkId: string | undefined;
  sources: FakeSource[] = [];
  decodeFailures = 0;
  decoded: ArrayBuffer[] = [];

  async resume(): Promise<void> {}
  async close(): Promise<void> {}
  async setSinkId(sinkId: string): Promise<void> { this.sinkId = sinkId; }
  async decodeAudioData(data: ArrayBuffer): Promise<SpeechOutputAudioBuffer> {
    if (this.decodeFailures > 0) {
      this.decodeFailures -= 1;
      throw new Error('partial frame');
    }
    this.decoded.push(data);
    return { duration: 1 };
  }
  createBufferSource(): SpeechOutputBufferSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

function setup(options: { decodeFailures?: number; deviceId?: string } = {}) {
  let subscriber: ((event: SpeechOutputEvent) => void) | undefined;
  const context = new FakeContext();
  if (options.decodeFailures) context.decodeFailures = options.decodeFailures;
  const controller = createSpeechOutputController({
    onEvent: (next) => { subscriber = next; return () => { subscriber = undefined; }; },
    resolveOutputDeviceId: async () => options.deviceId ?? 'speaker-1',
    createAudioContext: () => context,
  });
  const emit = (event: SpeechOutputEvent) => subscriber?.(event);
  return { controller, emit, context };
}

const started = (): SpeechOutputEvent => ({ type: 'synthesis-started', executionId: 'r1', sessionId: 's1' });
const chunk = (sequence: number, final = false): SpeechOutputEvent => ({
  type: 'audio-chunk', executionId: 'r1', sessionId: 's1', sequence, final,
  format: 'mp3', sampleRate: 32000, channels: 1, bytes: new Uint8Array([sequence]),
});
const completed = (): SpeechOutputEvent => ({ type: 'completed', executionId: 'r1', sessionId: 's1' });
const stopped = (): SpeechOutputEvent => ({ type: 'stopped', executionId: 'r1', sessionId: 's1', reason: 'replaced' });
const error = (): SpeechOutputEvent => ({
  type: 'error', executionId: 'r1', sessionId: 's1', failure: { code: 'x', message: 'synthesis exploded' },
});

describe('createSpeechOutputController', () => {
  it('plays chunks on the configured output device and settles to idle', async () => {
    const { controller, emit, context } = setup();
    const seen = vi.fn();
    controller.subscribe(seen);

    emit(started());
    expect(controller.getSnapshot().status).toBe('playing');
    emit(chunk(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    emit(chunk(2, true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    emit(completed());
    expect(controller.getSnapshot().status).toBe('playing');
    // Simulate the scheduled sources draining.
    for (const source of [...context.sources]) source.stop();
    expect(controller.getSnapshot().status).toBe('idle');
    expect(context.sinkId).toBe('speaker-1');
    expect(context.decoded).toHaveLength(2);
  });

  it('accumulates partial mp3 frames until they decode', async () => {
    const { controller, emit, context } = setup({ decodeFailures: 1 });
    emit(started());
    emit(chunk(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(context.sources).toHaveLength(0); // first frame not yet decodable
    emit(chunk(2, true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(context.sources).toHaveLength(1); // accumulated bytes decoded together
    expect(context.decoded[0]!.byteLength).toBe(2);
  });

  it('surfaces errors and stops playback', () => {
    const { controller, emit } = setup();
    emit(started());
    emit(chunk(1));
    emit(error());
    expect(controller.getSnapshot()).toEqual({
      status: 'error',
      errorCode: 'x',
      errorMessage: 'synthesis exploded',
    });
  });

  it('stops on the stopped event', () => {
    const { controller, emit, context } = setup();
    emit(started());
    emit(chunk(1));
    emit(stopped());
    expect(controller.getSnapshot().status).toBe('idle');
    expect(context.sources.every((source) => source.stopped)).toBe(true);
  });

  it('stops previous sources when a replacement synthesis starts', async () => {
    const { controller, emit, context } = setup();
    emit(started());
    emit(chunk(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(context.sources).toHaveLength(1);
    emit(started());
    expect(context.sources[0]!.stopped).toBe(true);
    expect(controller.getSnapshot().status).toBe('playing');
  });

  it('reports an error when nothing ever decodes', async () => {
    const { controller, emit } = setup({ decodeFailures: 99 });
    emit(started());
    emit(chunk(1, true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    emit(completed());
    expect(controller.getSnapshot().status).toBe('error');
  });

  it('stops local playback and disposes the subscription', () => {
    const { controller, emit, context } = setup();
    emit(started());
    emit(chunk(1));
    controller.stopLocal();
    expect(controller.getSnapshot().status).toBe('idle');
    expect(context.sources.every((source) => source.stopped)).toBe(true);

    controller.dispose();
    emit(error()); // no subscriber left; must not throw
    expect(controller.getSnapshot().status).toBe('idle');
  });

  it('schedules each chunk exactly once even when decodes resolve out of order', async () => {
    const pendingDecodes: Array<{
      bytes: number[];
      resolve: () => void;
    }> = [];
    const sources: FakeSource[] = [];
    const context = {
      currentTime: 10,
      destination: {},
      sinkId: undefined as string | undefined,
      async resume(): Promise<void> {},
      async close(): Promise<void> {},
      async setSinkId(sinkId: string): Promise<void> { this.sinkId = sinkId; },
      decodeAudioData(data: ArrayBuffer): Promise<SpeechOutputAudioBuffer> {
        const bytes = Array.from(new Uint8Array(data));
        return new Promise<SpeechOutputAudioBuffer>((resolve) => {
          pendingDecodes.push({ bytes, resolve: () => resolve({ duration: 1 }) });
        });
      },
      createBufferSource(): SpeechOutputBufferSource {
        const source = new FakeSource();
        sources.push(source);
        return source;
      },
    };
    let subscriber: ((event: SpeechOutputEvent) => void) | undefined;
    const controller = createSpeechOutputController({
      onEvent: (next) => { subscriber = next; return () => { subscriber = undefined; }; },
      resolveOutputDeviceId: async () => 'default',
      createAudioContext: () => context,
    });
    const emit = (event: SpeechOutputEvent) => subscriber?.(event);

    emit(started());
    emit(chunk(1));
    emit(chunk(2, true));
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Chunks are processed strictly in order: only chunk 1's decode is in
    // flight while chunk 2 waits, so no decode ever sees shared bytes.
    expect(pendingDecodes).toHaveLength(1);
    expect(pendingDecodes[0]!.bytes).toEqual([1]);
    pendingDecodes[0]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(pendingDecodes).toHaveLength(2);
    expect(pendingDecodes[1]!.bytes).toEqual([2]);
    pendingDecodes[1]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Each chunk must be decoded from its own bytes and scheduled exactly once.
    expect(pendingDecodes.map((entry) => entry.bytes)).toEqual([[1], [2]]);
    expect(sources).toHaveLength(2);
  });
});
