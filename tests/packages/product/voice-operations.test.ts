import { describe, expect, it, vi } from 'vitest';
import { createVoice, type SpeechInputRuntime } from '../../../packages/voice/src';
import { createVoiceOperations } from '../../../packages/product/src/operations/voice-operations';

function noopSpeechInput(): SpeechInputRuntime {
  return {
    async start() { return { status: 'started', generation: 4 }; },
    acceptFrame() {},
    setMuted() {},
    startManualUtterance() {},
    finishManualUtterance() {},
    async stop() {},
    subscribe() { return () => undefined; },
  };
}

describe('Product Voice operations', () => {
  it('exposes truthful aggregate Voice model status and update discovery', async () => {
    const checkForUpdates = vi.fn(async () => ({ status: 'checked' as const, bundleVersion: 'voice-v2' }));
    const voice = createVoice({
      speechInput: noopSpeechInput(),
      models: {
        getStatus: () => ({
          status: 'preparing' as const,
          phase: 'downloading' as const,
          bundleVersion: 'voice-v2',
          downloadedBytes: 25,
          totalBytes: 100,
          progress: 0.25,
          bytesPerSecond: 10,
        }),
        checkForUpdates,
        async prepare() { return { status: 'ready' as const }; },
        async cancelPreparation() { return { status: 'idle' as const }; },
        getModelPath() { return 'models'; },
        getCapabilityStatus: () => ({ status: 'ready' as const }),
      },
    });
    const host = createVoiceOperations({ voice });

    expect(await host.getModelStatus()).toEqual({
      status: 'preparing',
      phase: 'downloading',
      bundleVersion: 'voice-v2',
      downloadedBytes: 25,
      totalBytes: 100,
      progress: 0.25,
      bytesPerSecond: 10,
    });
    expect(await host.checkModelUpdates()).toEqual({ status: 'checked', bundleVersion: 'voice-v2' });
  });

  it('starts and ends the Voice Session through the injected Speech Input runtime', async () => {
    const stop = vi.fn(async () => undefined);
    const voice = createVoice({
      speechInput: {
        async start() { return { status: 'started', generation: 4 }; },
        acceptFrame() {},
        setMuted() {},
        startManualUtterance() {},
        finishManualUtterance() {},
        stop,
        subscribe() { return () => undefined; },
      },
    });
    const host = createVoiceOperations({ voice });

    await expect(host.startSession({ boundSessionId: 'session:one' })).resolves.toEqual({
      status: 'ok',
      generation: 4,
    });
    expect((await host.getSnapshot()).status).toBe('listening');

    expect(await host.endSession()).toEqual({ status: 'ok' });
    expect(stop).toHaveBeenCalledWith({ generation: 4, reason: 'session_ended' });
  });

  it('reports the speech input capability through the Voice Host', async () => {
    const voice = createVoice({
      speechInput: noopSpeechInput(),
      models: {
        getStatus: () => ({ status: 'ready', bundleVersion: 'voice-v1' }),
        checkForUpdates: async () => ({ status: 'unavailable' }),
        prepare: async () => ({ status: 'ready' }),
        cancelPreparation: async () => ({ status: 'idle' }),
        getModelPath: () => 'C:/models',
        getCapabilityStatus: () => ({ status: 'ready' }),
      },
    });
    const host = createVoiceOperations({ voice });

    expect(await host.getModelCapabilityStatus({ capability: 'stt' })).toEqual({ status: 'ready' });
  });

  it('delegates manual utterance boundaries to the injected Speech Input runtime', async () => {
    const startManualUtterance = vi.fn();
    const finishManualUtterance = vi.fn();
    const voice = createVoice({
      speechInput: {
        async start() { return { status: 'started', generation: 4 }; },
        acceptFrame() {},
        setMuted() {},
        startManualUtterance,
        finishManualUtterance,
        async stop() {},
        subscribe() { return () => undefined; },
      },
    });
    const host = createVoiceOperations({ voice });
    await host.startSession({ boundSessionId: 'session:one' });

    expect(await host.startManualUtterance()).toEqual({ status: 'ok' });
    expect(startManualUtterance).toHaveBeenCalledWith({ generation: 4 });
    expect(await host.finishManualUtterance()).toEqual({ status: 'ok' });
    expect(finishManualUtterance).toHaveBeenCalledWith({ generation: 4 });
  });
});
