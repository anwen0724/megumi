import { describe, expect, it, vi } from 'vitest';
import {
  createSpeechInputRuntime,
  type SpeechInputEvent,
  type SpeechInputRuntime,
} from '../../../packages/agent/voice/src/speech-input/speech-input-runtime';
import type { SpeechVad } from '../../../packages/agent/voice/src/speech-input/sherpa-vad';
import type { SpeechRecognizer } from '../../../packages/agent/voice/src';

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
  speakUtteranceFrom(runtime, classification, 0);
}

function speakUtteranceFrom(runtime: SpeechInputRuntime, classification: boolean[], startSequence: number) {
  for (let index = 0; index < classification.length; index += 1) {
    runtime.acceptFrame(frame(1, startSequence + index, classification[index]!));
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

describe('Speech Input runtime regressions', () => {
  it('emits runtime-ready only after the VAD initialization has been decided', async () => {
    const load = deferred<void>();
    const { runtime, events } = createTestRuntimeWithVadGate(load.promise);
    const starting = runtime.start({ generation: 1 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([]);

    load.resolve();
    await starting;

    expect(events[0]).toEqual({ type: 'runtime-ready', generation: 1 });
    expect(events[1]).toEqual({ type: 'listening', generation: 1 });
  });

  it('orders runtime-ready before automatic-boundary-unavailable when the VAD fails', async () => {
    const { runtime, events } = createTestRuntime({ vadFailures: { load: new Error('no model') } });
    await runtime.start({ generation: 1 });

    expect(events.map((event) => event.type)).toEqual([
      'runtime-ready',
      'automatic-boundary-unavailable',
    ]);
    expect(events.filter((event) => event.type === 'listening')).toHaveLength(0);
  });

  it('ignores frames while the runtime is still starting', async () => {
    const load = deferred<void>();
    const { runtime, events, acceptFrames } = createTestRuntimeWithVadGate(load.promise);
    const starting = runtime.start({ generation: 1 });

    runtime.acceptFrame(frame(1, 0, true));
    runtime.acceptFrame(frame(1, 1, true));
    expect(acceptFrames).toHaveLength(0); // frames never reached the VAD
    expect(events).toEqual([]);

    load.resolve();
    await starting;
  });

  it('discards a decode that settles after mute and emits no result events', async () => {
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

    runtime.setMuted({ muted: true });
    runtime.setMuted({ muted: false });

    // The old decode finishes with text AFTER unmute; it must not surface.
    recognition.resolve({ status: 'recognized', transcript: 'old text' });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'listening')).toBe(true);
    });
    expect(events.filter((event) => event.type === 'final-transcript')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'empty-utterance')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'recognition-failed')).toHaveLength(0);
  });

  it('never runs a new recognition in parallel with a settling stale decode', async () => {
    const pending: Array<ReturnType<typeof deferred<Awaited<ReturnType<SpeechRecognizer['recognize']>>>>> = [];
    const recognizer: SpeechRecognizer = {
      async recognize() {
        const recognition = deferred<Awaited<ReturnType<SpeechRecognizer['recognize']>>>();
        pending.push(recognition);
        return recognition.promise;
      },
    };
    const utterance = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    // The middle utterance is dropped before the VAD, so only the first and
    // third batches consume classifications.
    const classification = [...utterance, ...utterance];
    const { runtime, events } = createTestRuntime({ recognizer, classification });
    await runtime.start({ generation: 1 });

    // First utterance starts a recognition; mute invalidates it mid-decode.
    speakUtterance(runtime, utterance);
    await vi.waitFor(() => { expect(pending).toHaveLength(1); });
    runtime.setMuted({ muted: true });
    runtime.setMuted({ muted: false });

    // A second utterance completes while the old decode still runs: no
    // parallel recognition is started.
    speakUtteranceFrom(runtime, utterance, utterance.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending).toHaveLength(1);

    // The stale decode settles with text; it is discarded, which returns the
    // runtime to listening (the second listening event in this run).
    pending[0]!.resolve({ status: 'recognized', transcript: 'old text' });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'listening')).toHaveLength(2);
    });

    // The next utterance recognizes normally through the same runtime.
    speakUtteranceFrom(runtime, utterance, utterance.length * 2);
    await vi.waitFor(() => { expect(pending).toHaveLength(2); });
    pending[1]!.resolve({ status: 'recognized', transcript: 'new text' });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'final-transcript')).toHaveLength(1);
    });
    const finalEvent = events.find((event) => event.type === 'final-transcript');
    expect(finalEvent).toMatchObject({ transcript: { text: 'new text' } });
  });

  it('does not emit a false audio-overflow after frames dropped during recognition', async () => {
    const recognitions: Array<{ pcm: Float32Array }> = [];
    const recognition = deferred<Awaited<ReturnType<SpeechRecognizer['recognize']>>>();
    const recognizer: SpeechRecognizer = {
      async recognize(request) {
        recognitions.push({ pcm: request.pcm.samples });
        return recognition.promise;
      },
    };
    const utterance = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    // One classification entry per processed utterance; frames ignored during
    // recognition never reach the VAD.
    const classification = [...utterance, ...utterance];
    const { runtime, events } = createTestRuntime({ recognizer, classification });
    await runtime.start({ generation: 1 });

    speakUtterance(runtime, utterance);
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'recognizing')).toBe(true);
    });

    // The Renderer keeps producing frames while recognition runs; they are
    // deliberately ignored, not lost.
    for (let sequence = utterance.length; sequence < utterance.length + 33; sequence += 1) {
      runtime.acceptFrame(frame(1, sequence, false));
    }

    recognition.resolve({ status: 'empty' });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'empty-utterance')).toBe(true);
    });
    expect(events.filter((event) => event.type === 'audio-overflow')).toHaveLength(0);

    // A fresh utterance starting at a continuing sequence works normally.
    speakUtteranceFrom(runtime, utterance, utterance.length + 33);
    await vi.waitFor(() => { expect(recognitions).toHaveLength(2); });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'empty-utterance')).toHaveLength(2);
    });
    expect(events.filter((event) => event.type === 'audio-overflow')).toHaveLength(0);
  });

  it('prepares the recognizer once and reports stt events around runtime-ready', async () => {
    const prepares: Array<{ language: string }> = [];
    const recognizer: SpeechRecognizer = {
      async recognize() { return { status: 'recognized', transcript: 'ok' }; },
      async prepare(request: { language: string }) {
        prepares.push({ language: request.language });
        return { status: 'ready' };
      },
    };
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events } = createTestRuntime({ recognizer, classification });
    await runtime.start({ generation: 1, language: 'zh' });

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'stt-ready')).toBe(true);
    });
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes.indexOf('runtime-ready')).toBeLessThan(eventTypes.indexOf('stt-preparing'));
    expect(eventTypes.indexOf('stt-preparing')).toBeLessThan(eventTypes.indexOf('stt-ready'));
    expect(prepares).toEqual([{ language: 'zh' }]);
  });

  it('reports stt-failed and allows a fresh start to retry preparation', async () => {
    let attempts = 0;
    const recognizer: SpeechRecognizer = {
      async recognize() { return { status: 'empty' }; },
      async prepare() {
        attempts += 1;
        if (attempts === 1) {
          return {
            status: 'failed',
            failure: { code: 'sensevoice_preparation_failed', message: 'Model missing.' },
          };
        }
        return { status: 'ready' };
      },
    };
    const { runtime, events } = createTestRuntime({ recognizer });
    await runtime.start({ generation: 1 });

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'stt-failed')).toBe(true);
    });
    const failedEvent = events.find((event) => event.type === 'stt-failed');
    expect(failedEvent).toMatchObject({ failure: { code: 'sensevoice_preparation_failed' } });
    // The runtime stays usable for the microphone and VAD.
    expect(runtime.getStatus()).toBe('listening');

    await runtime.stop({ generation: 1, reason: 'user' });
    await runtime.start({ generation: 2 });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'stt-ready' && event.generation === 2)).toBe(true);
    });
    expect(attempts).toBe(2);
  });

  it('waits for recognizer preparation before decoding the first utterance', async () => {
    const preparation = deferred<{ status: 'ready' }>();
    const recognize = vi.fn(async () => ({ status: 'recognized' as const, transcript: '首句' }));
    const recognizer: SpeechRecognizer = {
      recognize,
      prepare: vi.fn(() => preparation.promise),
    };
    const classification = [
      ...Array<boolean>(MIN_SPEECH_FRAMES).fill(true),
      ...Array<boolean>(END_SILENCE_FRAMES).fill(false),
    ];
    const { runtime, events } = createTestRuntime({ recognizer, classification });
    await runtime.start({ generation: 1, language: 'zh' });

    speakUtterance(runtime, classification);
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'recognizing')).toBe(true);
    });
    expect(recognize).not.toHaveBeenCalled();

    preparation.resolve({ status: 'ready' });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'final-transcript')).toBe(true);
    });
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it('reports a thrown recognizer error instead of rewriting it as cancellation', async () => {
    const recognizer: SpeechRecognizer = {
      async recognize() { throw new Error('decoder exploded'); },
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
    expect(events.find((event) => event.type === 'recognition-failed')).toMatchObject({
      failure: { code: 'voice_recognition_failed', message: 'decoder exploded' },
    });
  });
});

function createTestRuntimeWithVadGate(load: Promise<void>) {
  const events: SpeechInputEvent[] = [];
  const acceptFrames: Float32Array[] = [];
  const vad: SpeechVad = {
    accept(samplesValue) { acceptFrames.push(samplesValue); },
    isSpeech() { return true; },
    reset() {},
  };
  const runtime = createSpeechInputRuntime({
    vad: async () => {
      await load;
      return vad;
    },
    recognizer: { async recognize() { return { status: 'empty' }; } },
    ids: { createUtteranceId: () => 'utterance:1' },
  });
  runtime.subscribe((event) => events.push(event));
  return { runtime, events, acceptFrames };
}
