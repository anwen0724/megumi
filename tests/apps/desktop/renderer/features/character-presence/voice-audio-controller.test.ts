import { describe, expect, it, vi } from 'vitest';
import {
  createVoiceAudioController,
  resolveVadRuntimeAssetUrls,
} from '@megumi/desktop/renderer/features/character-presence/voice-audio-controller';

describe('VoiceAudioController', () => {
  it('resolves VAD runtime assets from the renderer page instead of the Vite dependency bundle', () => {
    expect(resolveVadRuntimeAssetUrls('http://127.0.0.1:5173/character.html')).toEqual({
      baseAssetPath: 'http://127.0.0.1:5173/vad/',
      onnxWASMBasePath: 'http://127.0.0.1:5173/vad/onnx/',
    });
    expect(resolveVadRuntimeAssetUrls('file:///C:/Megumi/resources/app/.vite/renderer/main_window/character.html')).toEqual({
      baseAssetPath: 'file:///C:/Megumi/resources/app/.vite/renderer/main_window/vad/',
      onnxWASMBasePath: 'file:///C:/Megumi/resources/app/.vite/renderer/main_window/vad/onnx/',
    });
  });

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

    await controller.start({ inputDeviceId: 'microphone-2', language: 'zh' });
    const audio = new Float32Array([0.1, 0.2]);
    await Promise.all([onSpeechEnd?.(audio), onSpeechEnd?.(audio)]);

    expect(submitAudio).toHaveBeenCalledOnce();
    expect(submitAudio).toHaveBeenCalledWith(expect.objectContaining({ language: 'zh' }));
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

  it('passes the selected device to initial and resumed VAD capture', async () => {
    const configurations: unknown[] = [];
    const controller = createVoiceAudioController({
      createVad: async (_callbacks, configuration) => {
        configurations.push(configuration);
        return { start: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
      },
      submitAudio: vi.fn(),
      onTranscript: vi.fn(),
    });

    await controller.start({ inputDeviceId: 'usb-mic', language: 'en' });

    expect(configurations).toEqual([{ inputDeviceId: 'usb-mic' }]);
  });

  it('primes the browser audio context during the user gesture before VAD starts later', async () => {
    const audioContext = {
      state: 'suspended',
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    const configurations: unknown[] = [];
    const controller = createVoiceAudioController({
      createAudioContext: () => audioContext,
      createVad: async (_callbacks, configuration) => {
        configurations.push(configuration);
        return { start: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
      },
      submitAudio: vi.fn(),
      onTranscript: vi.fn(),
    });

    controller.primeForUserGesture();
    expect(audioContext.resume).toHaveBeenCalledOnce();
    Object.defineProperty(audioContext, 'state', { configurable: true, value: 'running' });
    await controller.start({ inputDeviceId: 'usb-mic' });

    expect(audioContext.resume).toHaveBeenCalledOnce();
    expect(configurations).toEqual([{ inputDeviceId: 'usb-mic', audioContext }]);
  });

  it('publishes real microphone energy separately from VAD speech probability', async () => {
    let onFrameProcessed:
      | ((probabilities: { readonly isSpeech: number }, frame: Float32Array) => void)
      | undefined;
    const controller = createVoiceAudioController({
      createVad: async (callbacks) => {
        onFrameProcessed = callbacks.onFrameProcessed;
        return { start: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
      },
      submitAudio: vi.fn(),
      onTranscript: vi.fn(),
    });

    await controller.start();
    onFrameProcessed?.({ isSpeech: 0.8 }, new Float32Array([0.1, -0.1, 0.1, -0.1]));

    expect(controller.getSnapshot()).toMatchObject({
      status: 'listening',
      speechProbability: 0.8,
      audioFramesReceived: true,
    });
    expect(controller.getSnapshot().inputLevel).toBeGreaterThan(0);
  });

  it('reports an empty recognition result instead of silently returning to listening', async () => {
    let onSpeechEnd: ((audio: Float32Array) => Promise<void> | void) | undefined;
    const controller = createVoiceAudioController({
      createVad: async (callbacks) => {
        onSpeechEnd = callbacks.onSpeechEnd;
        return { start: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
      },
      submitAudio: vi.fn(async () => ({
        status: 'empty' as const,
        snapshot: { status: 'listening' as const, boundSessionId: 'session-1', voiceProfileId: 'default', muted: false },
      })),
      onTranscript: vi.fn(),
    });

    await controller.start();
    await onSpeechEnd?.(new Float32Array([0.1]));

    expect(controller.getSnapshot()).toMatchObject({ status: 'listening', issue: 'empty' });
  });
});
