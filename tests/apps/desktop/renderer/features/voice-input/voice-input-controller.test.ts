import { describe, expect, it, vi } from 'vitest';
import { createVoiceInputController } from '@megumi/desktop/renderer/features/voice-input/voice-input-controller';
import type { MicrophoneCapture } from '@megumi/desktop/renderer/features/voice-input/microphone-capture';
import type { FinalTranscript, SpeechInputEvent } from '@megumi/voice';

function fakeCapture() {
  const snapshot = {
    status: 'closed' as const,
    level: 0,
    peak: 0,
    framesReceived: false,
    fallbackToDefault: false,
  };
  const listeners = new Set<(value: typeof snapshot) => void>();
  const open = vi.fn(async () => ({ status: 'opened' as const, sampleRate: 16_000 as const, fallbackToDefault: false }));
  const close = vi.fn(async () => undefined);
  const setMuted = vi.fn();
  let frameHandler: ((frame: Float32Array) => void) | undefined;
  const capture: MicrophoneCapture = {
    open,
    close,
    setMuted,
    setFrameHandler(handler) { frameHandler = handler; },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    publish(next: Partial<typeof snapshot>) {
      Object.assign(snapshot, next);
      for (const listener of listeners) listener(snapshot);
    },
    emitFrame(frame: Float32Array) { frameHandler?.(frame); },
  };
  return { capture, open, close, setMuted };
}

function fakeEventBus() {
  const listeners = new Set<(event: SpeechInputEvent) => void>();
  const unsubscribe = vi.fn();
  return {
    listeners,
    unsubscribe,
    subscribeEvents: (listener: (event: SpeechInputEvent) => void) => {
      listeners.add(listener);
      return unsubscribe;
    },
    emit: (event: SpeechInputEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}

function createController() {
  const sentFrames: Array<{ generation: number; sequence: number; samples: Float32Array }> = [];
  const transcripts: FinalTranscript[] = [];
  const sendFrame = vi.fn((value) => { sentFrames.push(value); });
  const capture = fakeCapture();
  const events = fakeEventBus();
  const controller = createVoiceInputController({
    capture: capture.capture,
    sendFrame,
    subscribeEvents: events.subscribeEvents,
    onTranscript: (transcript) => transcripts.push(transcript),
  });
  return { controller, capture, events, sendFrame, sentFrames, transcripts };
}

function transcriptEvent(generation: number, text: string): SpeechInputEvent {
  return {
    type: 'final-transcript',
    generation,
    transcript: {
      generation,
      utteranceId: `utterance:${generation}`,
      text,
      startedAt: 0,
      endedAt: 100,
    },
  };
}

describe('Voice input controller', () => {
  it('streams captured frames into the bridge with per-generation sequences from zero', async () => {
    const { controller, capture, sentFrames } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 7 });

    expect(capture.open).toHaveBeenCalledWith({ inputDeviceId: 'mic:1' });
    capture.capture.emitFrame(new Float32Array(512).fill(0.1));
    capture.capture.emitFrame(new Float32Array(512).fill(0.2));

    expect(sentFrames.map((value) => [value.generation, value.sequence]))
      .toEqual([[7, 0], [7, 1]]);
    expect(sentFrames[0]!.samples[0]).toBeCloseTo(0.1);
  });

  it('projects microphone and speech states separately', async () => {
    const { controller, capture, events } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 1 });

    expect(controller.getSnapshot().speech).toBe('starting');

    events.emit({ type: 'runtime-ready', generation: 1 });
    events.emit({ type: 'listening', generation: 1 });
    expect(controller.getSnapshot().speech).toBe('listening');

    events.emit({ type: 'speech-started', generation: 1 });
    expect(controller.getSnapshot().speech).toBe('speech-detected');

    events.emit({ type: 'recognizing', generation: 1 });
    expect(controller.getSnapshot().speech).toBe('recognizing');

    capture.capture.publish({ status: 'capturing', level: 0.4, framesReceived: true });
    expect(controller.getSnapshot()).toMatchObject({
      microphone: 'capturing',
      level: 0.4,
      speech: 'recognizing',
    });
  });

  it('hands the Final Transcript to the text input and resumes listening', async () => {
    const { controller, events, transcripts } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 1 });

    events.emit(transcriptEvent(1, '你好，Megumi'));

    expect(transcripts).toEqual([expect.objectContaining({ text: '你好，Megumi', generation: 1 })]);
    expect(controller.getSnapshot().speech).toBe('listening');
  });

  it('discards transcripts and events from older generations', async () => {
    const { controller, events, transcripts } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 2 });

    events.emit(transcriptEvent(1, '旧句子'));
    events.emit({ type: 'recognizing', generation: 1 });

    expect(transcripts).toEqual([]);
    expect(controller.getSnapshot().speech).toBe('starting');
  });

  it('surfaces overflow, short utterances, and empty recognition as distinct issues', async () => {
    const { controller, events } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 1 });

    events.emit({ type: 'audio-overflow', generation: 1 });
    expect(controller.getSnapshot().issue).toBe('overflow');

    events.emit({ type: 'empty-utterance', generation: 1, source: 'boundary' });
    expect(controller.getSnapshot().issue).toBe('too_short');

    events.emit({ type: 'empty-utterance', generation: 1, source: 'recognition' });
    expect(controller.getSnapshot().issue).toBe('empty');
  });

  it('switches to manual boundary mode when automatic detection is unavailable', async () => {
    const { controller, events } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 1 });

    events.emit({ type: 'automatic-boundary-unavailable', generation: 1 });

    expect(controller.getSnapshot().speech).toBe('automatic-boundary-unavailable');
  });

  it('exposes runtime failures with the failure message', async () => {
    const { controller, events } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 1 });

    events.emit({
      type: 'runtime-failed',
      generation: 1,
      failure: { code: 'voice_worker_exited', message: 'Worker gone.' },
    });

    expect(controller.getSnapshot()).toMatchObject({
      speech: 'failed',
      speechError: 'Worker gone.',
    });
  });

  it('mutes the capture without closing the stream', async () => {
    const { controller, capture } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 1 });

    controller.setMuted(true);
    expect(capture.setMuted).toHaveBeenCalledWith(true);

    controller.setMuted(false);
    expect(capture.setMuted).toHaveBeenCalledWith(false);
    expect(capture.close).not.toHaveBeenCalled();
  });

  it('ends capture, stops forwarding, and disposes the event subscription', async () => {
    const { controller, capture, events, sentFrames } = createController();
    await controller.beginCapture({ inputDeviceId: 'mic:1', generation: 1 });

    await controller.endCapture();

    expect(capture.close).toHaveBeenCalled();
    expect(controller.getSnapshot().speech).toBe('stopped');
    expect(controller.getSnapshot().microphone).toBe('closed');

    capture.capture.emitFrame(new Float32Array(512));
    expect(sentFrames).toHaveLength(0);

    await controller.dispose();
    expect(events.unsubscribe).toHaveBeenCalled();
    expect(capture.close).toHaveBeenCalledTimes(2);
  });
});
