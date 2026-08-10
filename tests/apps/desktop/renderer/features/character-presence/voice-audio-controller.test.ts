import { describe, expect, it, vi } from 'vitest';
import { createVoiceAudioController } from '@megumi/desktop/renderer/features/character-presence/voice-audio-controller';

describe('VoiceAudioController', () => {
  it('submits one Final Transcript for a VAD endpoint and ignores a duplicate while recognizing', async () => {
    let onSpeechEnd: ((audio: Float32Array) => Promise<void> | void) | undefined;
    const vad = { start: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
    const submitAudio = vi.fn(async () => ({
      status: 'recognized' as const,
      transcript: '你好 Megumi',
      snapshot: { status: 'listening' as const, boundSessionId: 'session-1', voiceProfileId: 'default', muted: false },
    }));
    const transcripts: string[] = [];
    const controller = createVoiceAudioController({
      createVad: async (callbacks) => {
        onSpeechEnd = callbacks.onSpeechEnd;
        return vad;
      },
      submitAudio,
      onTranscript: (transcript) => transcripts.push(transcript),
    });

    await controller.start();
    const audio = new Float32Array([0.1, 0.2]);
    await Promise.all([onSpeechEnd?.(audio), onSpeechEnd?.(audio)]);

    expect(submitAudio).toHaveBeenCalledOnce();
    expect(transcripts).toEqual(['你好 Megumi']);
    expect(controller.getSnapshot().status).toBe('listening');
  });

  it('invalidates a late recognition result after the controller stops', async () => {
    let onSpeechEnd: ((audio: Float32Array) => Promise<void> | void) | undefined;
    let resolveRecognition: ((value: any) => void) | undefined;
    const transcript = vi.fn();
    const controller = createVoiceAudioController({
      createVad: async (callbacks) => {
        onSpeechEnd = callbacks.onSpeechEnd;
        return { start: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
      },
      submitAudio: () => new Promise((resolve) => { resolveRecognition = resolve; }),
      onTranscript: transcript,
    });

    await controller.start();
    const pending = onSpeechEnd?.(new Float32Array([0.2]));
    await controller.stop();
    resolveRecognition?.({
      status: 'recognized',
      transcript: 'late',
      snapshot: { status: 'idle' },
    });
    await pending;

    expect(transcript).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe('idle');
  });

  it('pauses and resumes capture for mute without ending the Voice Session', async () => {
    const vad = { start: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
    const controller = createVoiceAudioController({
      createVad: async () => vad,
      submitAudio: vi.fn(),
      onTranscript: vi.fn(),
    });

    await controller.start();
    await controller.setMuted(true);
    await controller.setMuted(false);

    expect(vad.pause).toHaveBeenCalledOnce();
    expect(vad.start).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status).toBe('listening');
  });
});
