import { describe, expect, it, vi } from 'vitest';
import {
  createSpeechInputRuntime,
  type SpeechInputEvent,
  type SpeechInputRuntime,
} from '../../../packages/voice/src/speech-input/speech-input-runtime';
import type { SpeechVad } from '../../../packages/voice/src/speech-input/sherpa-vad';
import type { SpeechRecognizer } from '../../../packages/voice/src';

/*
 * Boundary math at 16 kHz with 512-sample frames (32 ms per frame):
 *   minimum speech = ceil(250 / 32) = 8 frames
 *   end silence    = ceil(600 / 32) = 19 frames
 */
const MIN_SPEECH_FRAMES = 8;
const END_SILENCE_FRAMES = 19;

function samples(sequence: number, speech: boolean): Float32Array {
  return new Float32Array(512).fill(speech ? 0.2 : 0.01);
}

function frame(generation: number, sequence: number, speech: boolean) {
  return {
    generation,
    sequence,
    sampleRate: 16_000 as const,
    samples: samples(sequence, speech),
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function createTestRuntime(input: {
  readonly classification?: boolean[];
  readonly recognizer?: SpeechRecognizer;
  readonly vadFailures?: { readonly load?: Error; readonly accept?: Error };
  readonly ids?: { readonly createUtteranceId: () => string };
  readonly now?: () => number;
}) {
  const events: SpeechInputEvent[] = [];
  const recognitions: { pcm: Float32Array; language: string }[] = [];
  const acceptFrames: Float32Array[] = [];
  let classificationIndex = 0;
  const classification = input.classification ?? [];
  const vad: SpeechVad = {
    accept(samplesValue) {
      if (input.vadFailures?.accept) throw input.vadFailures.accept;
      acceptFrames.push(samplesValue);
    },
    isSpeech() {
      const value = classification[classificationIndex] ?? false;
      classificationIndex += 1;
      return value;
    },
    reset() { classificationIndex = 0; },
  };
  const recognizer: SpeechRecognizer = input.recognizer ?? {
    async recognize(request) {
      recognitions.push({ pcm: request.pcm.samples, language: request.language });
      return { status: 'recognized', transcript: '你好，Megumi。' };
    },
  };
  let utteranceCount = 0;
  const runtime = createSpeechInputRuntime({
    vad: async () => {
      if (input.vadFailures?.load) throw input.vadFailures.load;
      return vad;
    },
    recognizer,
    ids: input.ids ?? { createUtteranceId: () => `utterance:${++utteranceCount}` },
    now: input.now ?? (() => 0),
  });
  runtime.subscribe((event) => events.push(event));
  return { runtime, events, recognitions, acceptFrames, classification };
}

/** Feeds one utterance; the speech/silence pattern comes from the
 *  classification array given to createTestRuntime. */
function speakUtterance(runtime: SpeechInputRuntime, classification: boolean[]) {
  for (let index = 0; index < classification.length; index += 1) {
    runtime.acceptFrame(frame(1, index, classification[index]!));
  }
}

describe('Speech Input runtime', () => {
  it('starts, reports runtime-ready and listening, and returns the generation', async () => {
    const { runtime, events } = createTestRuntime({});

    const result = await runtime.start({ generation: 1, language: 'zh' });

    expect(result).toEqual({ status: 'started', generation: 1 });
    expect(events.map((event) => event.type)).toEqual(['runtime-ready', 'listening']);
    expect(events[0]).toMatchObject({ type: 'runtime-ready', generation: 1 });
  });

  it('runs automatic boundary detection into one Final Transcript and resumes listening', async () => {
    // 8 speech frames + 19 trailing silence frames complete one utterance.
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events, recognitions } = createTestRuntime({ classification });
    await runtime.start({ generation: 1 });

    speakUtterance(runtime, classification);

    await vi.waitFor(() => {
      expect(recognitions).toHaveLength(1);
    });
    expect(recognitions[0]!.pcm.length).toBe(
      (MIN_SPEECH_FRAMES + END_SILENCE_FRAMES) * 512,
    );
    expect(recognitions[0]!.language).toBe('auto');
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain('speech-started');
    expect(eventTypes).toContain('speech-ended');
    expect(eventTypes).toContain('recognizing');
    const finalEvent = events.find((event) => event.type === 'final-transcript');
    expect(finalEvent).toMatchObject({
      type: 'final-transcript',
      generation: 1,
      transcript: {
        generation: 1,
        utteranceId: 'utterance:1',
        text: '你好，Megumi。',
      },
    });
    // The last event after the transcript is a fresh listening state.
    expect(events[events.length - 1]!.type).toBe('listening');
  });

  it('does not call STT for utterances below the 250 ms minimum', async () => {
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES - 1).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events, recognitions } = createTestRuntime({ classification });
    await runtime.start({ generation: 1 });

    speakUtterance(runtime, classification);

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'empty-utterance')).toBe(true);
    });
    const emptyEvent = events.find((event) => event.type === 'empty-utterance');
    expect(emptyEvent).toMatchObject({ generation: 1, source: 'boundary' });
    expect(recognitions).toHaveLength(0);
  });

  it('rejects new utterances while recognition is in progress and accepts the next one after', async () => {
    const recognition = deferred<Awaited<ReturnType<SpeechRecognizer['recognize']>>>();
    const recognizer: SpeechRecognizer = {
      async recognize() { return recognition.promise; },
    };
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events } = createTestRuntime({ recognizer, classification });
    await runtime.start({ generation: 1 });

    speakUtterance(runtime, classification);
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'recognizing')).toBe(true);
    });

    // Frames arriving during recognition must not start a second utterance.
    speakUtterance(runtime, classification);
    expect(events.filter((event) => event.type === 'recognizing')).toHaveLength(1);

    recognition.resolve({ status: 'recognized', transcript: '第二句。' });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'final-transcript')).toHaveLength(1);
    });
    expect(events[events.length - 1]!.type).toBe('listening');
  });

  it('drops invalid frames without breaking the runtime', async () => {
    const { runtime, events } = createTestRuntime({});
    await runtime.start({ generation: 1 });

    runtime.acceptFrame({ generation: 1, sequence: 0, sampleRate: 48_000, samples: samples(0, true) });
    runtime.acceptFrame({ generation: 1, sequence: 0, sampleRate: 16_000, samples: new Float32Array(256) });
    const nanSamples = samples(0, true);
    nanSamples[10] = NaN;
    runtime.acceptFrame({ generation: 1, sequence: 0, sampleRate: 16_000, samples: nanSamples });
    // An old generation and a stopped runtime are also ignored.
    runtime.acceptFrame(frame(99, 0, true));

    expect(events.filter((event) => !['runtime-ready', 'listening'].includes(event.type))).toEqual([]);
    expect(events).toHaveLength(2);
  });

  it('fails the current utterance on audio overflow and resumes listening', async () => {
    const { runtime, events, recognitions } = createTestRuntime({});
    await runtime.start({ generation: 1 });

    // A sequence gap mid-utterance behaves like an overflow: the utterance is discarded.
    runtime.acceptFrame(frame(1, 0, true));
    runtime.acceptFrame(frame(1, 5, true));

    expect(events).toContainEqual({ type: 'audio-overflow', generation: 1 });
    expect(recognitions).toHaveLength(0);
    expect(events[events.length - 1]!.type).toBe('listening');
    expect(runtime.getStatus()).toBe('listening');
  });

  it('degrades to manual boundary mode when the VAD cannot load and still recognizes', async () => {
    const { runtime, events, recognitions } = createTestRuntime({
      vadFailures: { load: new Error('VAD model missing.') },
    });
    const result = await runtime.start({ generation: 1 });

    expect(result.status).toBe('started');
    expect(events).toContainEqual({ type: 'automatic-boundary-unavailable', generation: 1 });

    runtime.startManualUtterance({ generation: 1 });
    runtime.acceptFrame(frame(1, 0, false));
    runtime.acceptFrame(frame(1, 1, false));
    runtime.finishManualUtterance({ generation: 1 });

    await vi.waitFor(() => {
      expect(recognitions).toHaveLength(1);
    });
    expect(events.find((event) => event.type === 'final-transcript')).toBeDefined();
  });

  it('degrades to manual mode when VAD classification fails mid-run without closing the microphone', async () => {
    const { runtime, events } = createTestRuntime({
      vadFailures: { accept: new Error('Native VAD crashed.') },
    });
    await runtime.start({ generation: 1 });

    runtime.acceptFrame(frame(1, 0, true));

    expect(events).toContainEqual({ type: 'automatic-boundary-unavailable', generation: 1 });
    expect(runtime.getStatus()).toBe('automatic-boundary-unavailable');
    // Manual recording still works through the same runtime and reaches STT.
    runtime.startManualUtterance({ generation: 1 });
    runtime.acceptFrame(frame(1, 1, false));
    runtime.finishManualUtterance({ generation: 1 });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'final-transcript')).toBe(true);
    });
  });

  it('maps a VAD-free short manual utterance to empty instead of STT', async () => {
    const { runtime, events, recognitions } = createTestRuntime({
      vadFailures: { load: new Error('no model') },
    });
    await runtime.start({ generation: 1 });

    runtime.startManualUtterance({ generation: 1 });
    runtime.finishManualUtterance({ generation: 1 });

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'empty-utterance')).toBe(true);
    });
    expect(recognitions).toHaveLength(0);
  });

  it('emits recognition-failed and resumes listening when STT fails', async () => {
    const recognizer: SpeechRecognizer = {
      async recognize() {
        return {
          status: 'failed',
          failure: { code: 'sensevoice_recognition_failed', message: 'Decoder crashed.' },
        };
      },
    };
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events } = createTestRuntime({ recognizer, classification });
    await runtime.start({ generation: 1 });

    speakUtterance(runtime, classification);

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'recognition-failed')).toBe(true);
    });
    expect(events[events.length - 1]!.type).toBe('listening');
  });

  it('emits empty-utterance with a recognition source when STT finds no text', async () => {
    const recognizer: SpeechRecognizer = {
      async recognize() { return { status: 'empty' }; },
    };
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events } = createTestRuntime({ recognizer, classification });
    await runtime.start({ generation: 1 });

    speakUtterance(runtime, classification);

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'empty-utterance')).toBe(true);
    });
    const emptyEvent = events.find((event) => event.type === 'empty-utterance');
    expect(emptyEvent).toMatchObject({ source: 'recognition' });
  });

  it('cancels in-flight recognition on stop and never emits a stale transcript', async () => {
    const recognition = deferred<Awaited<ReturnType<SpeechRecognizer['recognize']>>>();
    const signals: AbortSignal[] = [];
    const recognizer: SpeechRecognizer = {
      async recognize(_request, options) {
        signals.push(options?.signal ?? new AbortController().signal);
        return recognition.promise;
      },
    };
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events } = createTestRuntime({ recognizer, classification });
    await runtime.start({ generation: 1 });

    speakUtterance(runtime, classification);
    await vi.waitFor(() => {
      expect(signals).toHaveLength(1);
    });

    await runtime.stop({ generation: 1, reason: 'user' });

    expect(signals[0]!.aborted).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'stopped', generation: 1 });

    // A late result from the cancelled recognition is discarded entirely.
    recognition.resolve({ status: 'recognized', transcript: '迟到的结果。' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.filter((event) => event.type === 'final-transcript')).toHaveLength(0);
  });

  it('ignores control requests from older generations', async () => {
    const { runtime, events, recognitions } = createTestRuntime({});
    await runtime.start({ generation: 2 });

    runtime.startManualUtterance({ generation: 1 });
    runtime.acceptFrame(frame(1, 0, false));
    runtime.finishManualUtterance({ generation: 1 });
    await runtime.stop({ generation: 1, reason: 'user' });

    expect(recognitions).toHaveLength(0);
    expect(events.filter((event) => event.type === 'stopped')).toHaveLength(0);
    expect(runtime.getStatus()).toBe('listening');
  });

  it('clears the pending utterance when muted and resumes on unmute', async () => {
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events, recognitions } = createTestRuntime({ classification });
    await runtime.start({ generation: 1 });

    runtime.acceptFrame(frame(1, 0, true));
    runtime.setMuted({ muted: true });
    runtime.acceptFrame(frame(1, 1, true));
    runtime.acceptFrame(frame(1, 2, true));
    runtime.setMuted({ muted: false });

    // The pre-mute frame was discarded with the utterance.
    speakUtterance(runtime, classification);
    await vi.waitFor(() => {
      expect(recognitions).toHaveLength(1);
    });
    // Only frames from the fresh utterance reach the recognizer.
    expect(recognitions[0]!.pcm.length).toBe((MIN_SPEECH_FRAMES + END_SILENCE_FRAMES) * 512);
  });

  it('passes the start language through to the recognizer', async () => {
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, recognitions } = createTestRuntime({ classification });
    await runtime.start({ generation: 1, language: 'en' });

    speakUtterance(runtime, classification);
    await vi.waitFor(() => {
      expect(recognitions).toHaveLength(1);
    });
    expect(recognitions[0]!.language).toBe('en');
  });

  it('starts a new generation over an active one and invalidates the old events', async () => {
    const { runtime, events } = createTestRuntime({});
    await runtime.start({ generation: 1 });

    const started = await runtime.start({ generation: 2 });

    expect(started).toEqual({ status: 'started', generation: 2 });
    expect(events.at(-3)).toEqual({ type: 'stopped', generation: 1 });
    expect(events.at(-2)).toMatchObject({ type: 'runtime-ready', generation: 2 });
    expect(events[events.length - 1]).toEqual({ type: 'listening', generation: 2 });
  });

  it('is idempotent for stop', async () => {
    const { runtime, events } = createTestRuntime({});
    await runtime.start({ generation: 1 });
    await runtime.stop({ generation: 1, reason: 'user' });
    await runtime.stop({ generation: 1, reason: 'user' });

    expect(events.filter((event) => event.type === 'stopped')).toHaveLength(1);
  });
});
