import { describe, expect, it, vi } from 'vitest';
import {
  createVoice,
  type SpeechInputEvent,
  type SpeechInputRuntime,
  type SpeechPlayer,
  type SpeechRecognizer,
  type SpeechSynthesizer,
} from '../../../packages/voice/src/index';

function createNoopSpeechInput(): SpeechInputRuntime & { start: ReturnType<typeof vi.fn> } {
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

describe('Voice sessions', () => {
  it('starts speech input and listening without waiting for TTS preparation', async () => {
    let finishPreparation!: () => void;
    const prepare = vi.fn(() => new Promise<{ status: 'ready' }>((resolve) => {
      finishPreparation = () => resolve({ status: 'ready' });
    }));
    const speechInput = createNoopSpeechInput();
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: { prepare, async *synthesize() {} },
      player: unusedPlayer,
      speechInput,
    });

    const starting = voice.sessions.start({ boundSessionId: 'session:one' });

    // TTS preparation is still pending, yet the session must reach listening.
    await expect(starting).resolves.toMatchObject({
      status: 'started',
      snapshot: { status: 'listening' },
    });
    expect(prepare).toHaveBeenCalledWith({
      voiceProfileId: 'voice-profile:default',
      voice: { kind: 'built_in', voiceId: 'Xiaoyu' },
    }, { signal: expect.any(AbortSignal) });
    expect(speechInput.start).toHaveBeenCalledWith({ language: undefined });
    expect(voice.sessions.getSnapshot()).toMatchObject({
      status: 'listening',
      boundSessionId: 'session:one',
    });

    // TTS finishing later must not disturb the listening state.
    finishPreparation();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(voice.sessions.getSnapshot().status).toBe('listening');
  });

  it('keeps the session usable when TTS preparation fails', async () => {
    const speechInput = createNoopSpeechInput();
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: {
        async prepare() {
          return { status: 'failed' as const, failure: { code: 'tts_prepare_failed', message: 'Could not load TTS.' } };
        },
        async *synthesize() {},
      },
      player: unusedPlayer,
      speechInput,
    });

    await expect(voice.sessions.start({ boundSessionId: 'session:one' })).resolves.toMatchObject({
      status: 'started',
      snapshot: { status: 'listening' },
    });
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
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      speechInput,
    });

    await expect(voice.sessions.start({ boundSessionId: 'session:one' })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'voice_worker_unavailable', message: 'Worker could not start.' },
      snapshot: { status: 'idle' },
    });
    expect(voice.sessions.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('does not reopen speech input when the session ends during a slow start', async () => {
    let finishStart!: () => void;
    const speechInput = createNoopSpeechInput();
    speechInput.start.mockImplementation(() => new Promise((resolve) => {
      finishStart = () => resolve({ status: 'started' as const, generation: 1 });
    }));
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      speechInput,
    });

    const starting = voice.sessions.start({ boundSessionId: 'session:one' });
    await voice.sessions.end({ reason: 'character_hidden' });
    finishStart();

    await expect(starting).resolves.toEqual({ status: 'cancelled', snapshot: { status: 'idle' } });
    expect(voice.sessions.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('passes the session language to the speech input start request', async () => {
    const speechInput = createNoopSpeechInput();
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      speechInput,
    });

    await voice.sessions.start({ boundSessionId: 'session:one', language: 'zh' });

    expect(speechInput.start).toHaveBeenCalledWith({ language: 'zh' });
  });

  it('propagates mute and end to the injected speech input runtime', async () => {
    const speechInput = createNoopSpeechInput();
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      speechInput,
    });
    await voice.sessions.start({ boundSessionId: 'session:one' });

    voice.sessions.setMuted({ muted: true });
    expect(speechInput.setMuted).toHaveBeenCalledWith({ muted: true });
    expect(voice.sessions.getSnapshot()).toMatchObject({ muted: true });

    await voice.sessions.end({ reason: 'user' });
    expect(speechInput.stop).toHaveBeenCalledWith({ generation: 1, reason: 'session_ended' });
  });

  it('delegates manual utterance boundaries with the active generation', async () => {
    const speechInput = createNoopSpeechInput();
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      speechInput,
    });

    expect(voice.sessions.startManualUtterance()).toEqual({ status: 'not_active' });
    await voice.sessions.start({ boundSessionId: 'session:one' });

    expect(voice.sessions.startManualUtterance()).toEqual({ status: 'started' });
    expect(speechInput.startManualUtterance).toHaveBeenCalledWith({ generation: 1 });
    expect(voice.sessions.finishManualUtterance()).toEqual({ status: 'finished' });
    expect(speechInput.finishManualUtterance).toHaveBeenCalledWith({ generation: 1 });
  });

  it('maps speech input events to session runtime status while staying idle-safe', async () => {
    const speechInput = createNoopSpeechInput();
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      speechInput,
    });
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

  it('fixes the bound Session and selected Voice Profile until the Voice Session ends', async () => {
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      recognizer: unusedRecognizer,
      synthesizer: unusedSynthesizer,
      player: unusedPlayer,
      ids: { createVoiceProfileId: () => 'voice-profile:alternate' },
    });

    expect(voice.sessions.getSnapshot()).toMatchObject({ status: 'idle' });

    expect(await voice.sessions.start({ boundSessionId: 'session:one' })).toMatchObject({
      status: 'started',
      snapshot: {
        status: 'listening',
        boundSessionId: 'session:one',
        voiceProfileId: 'voice-profile:default',
        muted: false,
      },
    });

    await voice.profiles.import({
      name: 'Alternate',
      sourceAudioPath: 'C:/voices/alternate.wav',
    });
    expect(voice.profiles.select({ profileId: 'voice-profile:alternate' })).toEqual({
      status: 'selected',
      profileId: 'voice-profile:alternate',
    });
    expect(voice.sessions.getSnapshot()).toMatchObject({
      boundSessionId: 'session:one',
      voiceProfileId: 'voice-profile:default',
    });

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
      snapshot: {
        boundSessionId: 'session:two',
        voiceProfileId: 'voice-profile:alternate',
      },
    });
  });
});

const unusedRecognizer: SpeechRecognizer = {
  async recognize() {
    throw new Error('Recognizer should not be called in this test.');
  },
};

const unusedSynthesizer: SpeechSynthesizer = {
  async prepare() { return { status: 'ready' }; },
  async *synthesize() {
    throw new Error('Synthesizer should not be called in this test.');
  },
};

const unusedPlayer: SpeechPlayer = {
  async play() {
    throw new Error('Player should not be called in this test.');
  },
  async stop() {},
};
