import { describe, expect, it, vi } from 'vitest';
import {
  createVoice,
  type SpeechInputEvent,
  type SpeechInputRuntime,
} from '../../../packages/agent/voice/src/index';

function createNoopSpeechInput(): SpeechInputRuntime & { start: ReturnType<typeof vi.fn>; emit(event: SpeechInputEvent): void } {
  const listeners = new Set<(event: SpeechInputEvent) => void>();
  const runtime = {
    start: vi.fn(async ({ generation }: { readonly generation?: number }) => ({
      status: 'started' as const,
      generation: generation ?? 1,
    })),
    acceptFrame: vi.fn(),
    setMuted: vi.fn(),
    startManualUtterance: vi.fn(),
    finishManualUtterance: vi.fn(),
    stop: vi.fn(async () => undefined),
    subscribe(listener: (event: SpeechInputEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event: SpeechInputEvent) {
      for (const listener of listeners) listener(event);
    },
  };
  return runtime;
}

function createVoiceWithSpeechInput(speechInput = createNoopSpeechInput()) {
  return { voice: createVoice({ speechInput }), speechInput };
}

describe('Voice sessions', () => {
  it('starts speech input and reaches listening', async () => {
    const { voice, speechInput } = createVoiceWithSpeechInput();

    await expect(voice.sessions.start({ boundSessionId: 'session:one' })).resolves.toMatchObject({
      status: 'started',
      snapshot: { status: 'listening' },
    });
    expect(speechInput.start).toHaveBeenCalledWith({ language: undefined });
    expect(voice.sessions.getSnapshot()).toMatchObject({
      status: 'listening',
      boundSessionId: 'session:one',
    });
  });

  it('returns failed only when the speech input runtime itself cannot start', async () => {
    const speechInput = createNoopSpeechInput();
    speechInput.start.mockResolvedValue({
      status: 'failed',
      failure: { code: 'voice_worker_unavailable', message: 'Worker could not start.' },
    });
    const { voice } = createVoiceWithSpeechInput(speechInput);

    await expect(voice.sessions.start({ boundSessionId: 'session:one' })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'voice_worker_unavailable', message: 'Worker could not start.' },
      snapshot: { status: 'idle' },
    });
    expect(voice.sessions.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('recovers to idle after a speech input start failure and allows restarting', async () => {
    const speechInput = createNoopSpeechInput();
    speechInput.start
      .mockResolvedValueOnce({
        status: 'failed',
        failure: { code: 'voice_worker_start_failed', message: 'Worker entry missing.' },
      })
      .mockResolvedValueOnce({ status: 'started', generation: 2 });
    const { voice } = createVoiceWithSpeechInput(speechInput);

    await expect(voice.sessions.start({ boundSessionId: 'session:one' })).resolves.toMatchObject({
      status: 'failed',
    });
    // The failed start left the session idle — never stuck in preparing.
    expect(voice.sessions.getSnapshot()).toEqual({ status: 'idle' });

    await expect(voice.sessions.start({ boundSessionId: 'session:one' })).resolves.toMatchObject({
      status: 'started',
      snapshot: { status: 'listening' },
    });
    expect(voice.sessions.getSnapshot()).toMatchObject({ status: 'listening' });
  });

  it('does not reopen speech input when the session ends during a slow start', async () => {
    let finishStart!: () => void;
    const speechInput = createNoopSpeechInput();
    speechInput.start.mockImplementation(() => new Promise((resolve) => {
      finishStart = () => resolve({ status: 'started' as const, generation: 1 });
    }));
    const { voice } = createVoiceWithSpeechInput(speechInput);

    const starting = voice.sessions.start({ boundSessionId: 'session:one' });
    await voice.sessions.end({ reason: 'character_hidden' });
    finishStart();

    await expect(starting).resolves.toEqual({ status: 'cancelled', snapshot: { status: 'idle' } });
    expect(voice.sessions.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('passes the session language to the speech input start request', async () => {
    const { voice, speechInput } = createVoiceWithSpeechInput();

    await voice.sessions.start({ boundSessionId: 'session:one', language: 'zh' });

    expect(speechInput.start).toHaveBeenCalledWith({ language: 'zh' });
  });

  it('propagates mute and end to the injected speech input runtime', async () => {
    const { voice, speechInput } = createVoiceWithSpeechInput();
    await voice.sessions.start({ boundSessionId: 'session:one' });

    voice.sessions.setMuted({ muted: true });
    expect(speechInput.setMuted).toHaveBeenCalledWith({ muted: true });
    expect(voice.sessions.getSnapshot()).toMatchObject({ muted: true });

    await voice.sessions.end({ reason: 'user' });
    expect(speechInput.stop).toHaveBeenCalledWith({ generation: 1, reason: 'session_ended' });
  });

  it('delegates manual utterance boundaries with the active generation', async () => {
    const { voice, speechInput } = createVoiceWithSpeechInput();

    expect(voice.sessions.startManualUtterance()).toEqual({ status: 'not_active' });
    await voice.sessions.start({ boundSessionId: 'session:one' });

    expect(voice.sessions.startManualUtterance()).toEqual({ status: 'started' });
    expect(speechInput.startManualUtterance).toHaveBeenCalledWith({ generation: 1 });
    expect(voice.sessions.finishManualUtterance()).toEqual({ status: 'finished' });
    expect(speechInput.finishManualUtterance).toHaveBeenCalledWith({ generation: 1 });
  });

  it('maps speech input events to session runtime status while staying idle-safe', async () => {
    const speechInput = createNoopSpeechInput();
    const { voice } = createVoiceWithSpeechInput(speechInput);
    await voice.sessions.start({ boundSessionId: 'session:one' });

    speechInput.emit({ type: 'recognizing', generation: 1 });
    expect(voice.sessions.getSnapshot()).toMatchObject({ status: 'recognizing' });

    speechInput.emit({
      type: 'final-transcript',
      generation: 1,
      transcript: {
        generation: 1,
        utteranceId: 'utterance:1',
        text: '你好',
        startedAt: 0,
        endedAt: 1,
      },
    });
    expect(voice.sessions.getSnapshot()).toMatchObject({ status: 'listening' });

    speechInput.emit({ type: 'runtime-failed', generation: 1, failure: { code: 'voice_worker_exited', message: 'gone' } });
    expect(voice.sessions.getSnapshot()).toMatchObject({ status: 'error' });

    // Events from an older generation are ignored.
    await voice.sessions.end({ reason: 'user' });
    speechInput.emit({ type: 'recognizing', generation: 1 });
    expect(voice.sessions.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('allows a new speech input generation after the Worker crashes', async () => {
    const speechInput = createNoopSpeechInput();
    speechInput.start
      .mockResolvedValueOnce({ status: 'started', generation: 1 })
      .mockResolvedValueOnce({ status: 'started', generation: 2 });
    const { voice } = createVoiceWithSpeechInput(speechInput);
    await voice.sessions.start({ boundSessionId: 'session:one' });
    speechInput.emit({
      type: 'runtime-failed',
      generation: 1,
      failure: { code: 'voice_worker_exited', message: 'gone' },
    });

    await expect(voice.sessions.start({ boundSessionId: 'session:one' })).resolves.toMatchObject({
      status: 'started',
      generation: 2,
      snapshot: { status: 'listening' },
    });
    expect(speechInput.start).toHaveBeenCalledTimes(2);
  });

  it('fixes the bound Session until the Voice Session ends', async () => {
    const { voice } = createVoiceWithSpeechInput();

    expect(voice.sessions.getSnapshot()).toMatchObject({ status: 'idle' });

    expect(await voice.sessions.start({ boundSessionId: 'session:one' })).toMatchObject({
      status: 'started',
      snapshot: {
        status: 'listening',
        boundSessionId: 'session:one',
        muted: false,
      },
    });
    expect(voice.sessions.getSnapshot()).not.toHaveProperty('voiceProfileId');

    expect(voice.sessions.setMuted({ muted: true })).toMatchObject({
      status: 'updated',
      snapshot: { status: 'listening', muted: true },
    });
    expect(await voice.sessions.end()).toMatchObject({
      status: 'ended',
      snapshot: { status: 'idle' },
    });

    expect(await voice.sessions.start({ boundSessionId: 'session:two' })).toMatchObject({
      status: 'started',
      snapshot: { boundSessionId: 'session:two' },
    });
  });
});
