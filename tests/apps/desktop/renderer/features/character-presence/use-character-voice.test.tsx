/* Proves hiding the character window releases the Renderer microphone even
 * though the window stays mounted and the hook never unmounts. */
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCharacterVoice } from '@megumi/desktop/renderer/features/character-presence/use-character-voice';
import type { MicrophoneCapture } from '@megumi/desktop/renderer/features/voice-input/microphone-capture';

const frameSender = vi.hoisted(() => ({ close: vi.fn(), sendFrame: vi.fn() }));
vi.mock('@megumi/desktop/renderer/features/voice-input/frame-channel', () => ({
  openVoiceInputFrameSender: () => frameSender,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function fakeCapture(): MicrophoneCapture & { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn(async () => undefined);
  return {
    open: vi.fn(async () => ({ status: 'opened' as const, sampleRate: 16_000 as const, fallbackToDefault: false })),
    close,
    setMuted: vi.fn(),
    setFrameHandler: vi.fn(),
    getSnapshot: () => ({
      status: 'closed',
      level: 0,
      peak: 0,
      framesReceived: false,
      fallbackToDefault: false,
    }),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };
}

describe('useCharacterVoice window lifecycle', () => {
  let characterSnapshots: Array<(snapshot: { visible: boolean }) => void>;

  beforeEach(() => {
    characterSnapshots = [];
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        character: {
          onSnapshot: vi.fn((listener: (snapshot: { visible: boolean }) => void) => {
            characterSnapshots.push(listener);
            return vi.fn();
          }),
        },
        voice: {
          getSnapshot: vi.fn().mockResolvedValue({ ok: true, data: { status: 'idle' } }),
          getModelCapabilityStatus: vi.fn().mockResolvedValue({ ok: true, data: { status: 'ready' } }),
          startSession: vi.fn().mockResolvedValue({ ok: true, data: { status: 'ok', generation: 1 } }),
          endSession: vi.fn().mockResolvedValue({ ok: true, data: { status: 'ok' } }),
        },
        voiceInput: {
          onEvent: vi.fn(() => vi.fn()),
        },
        settings: {
          get: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              status: 'ok',
              settings: {
                voice: {
                  inputDeviceId: 'default',
                  recognitionLanguage: 'zh',
                },
              },
            },
          }),
        },
      },
    });
  });

  it('releases the microphone capture when the window is hidden, idempotently', async () => {
    const capture = fakeCapture();
    renderHook(() => useCharacterVoice('session-1', { createCapture: () => capture }));
    await waitFor(() => {
      expect(characterSnapshots).toHaveLength(1);
    });

    act(() => {
      characterSnapshots[0]!({ visible: false });
    });
    await waitFor(() => {
      expect(capture.close).toHaveBeenCalledTimes(1);
    });

    // Repeated hides stay safe; the capture never reopens on its own.
    act(() => {
      characterSnapshots[0]!({ visible: false });
      characterSnapshots[0]!({ visible: false });
    });
    await waitFor(() => {
      expect(capture.close).toHaveBeenCalledTimes(3);
    });
    expect(capture.open).not.toHaveBeenCalled();
  });

  it('ignores unrelated window snapshots while visible', async () => {
    const capture = fakeCapture();
    renderHook(() => useCharacterVoice('session-1', { createCapture: () => capture }));
    await waitFor(() => {
      expect(characterSnapshots).toHaveLength(1);
    });

    act(() => {
      characterSnapshots[0]!({ visible: true });
      characterSnapshots[0]!({ visible: true });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture.close).not.toHaveBeenCalled();
  });

  it('does not reopen the microphone when an in-flight start settles after hiding', async () => {
    const opening = deferred<{
      status: 'opened';
      sampleRate: 16000;
      fallbackToDefault: false;
    }>();
    const capture = fakeCapture();
    vi.mocked(capture.open).mockImplementation(() => opening.promise);
    const { result } = renderHook(() => useCharacterVoice('session-1', { createCapture: () => capture }));
    await waitFor(() => { expect(characterSnapshots).toHaveLength(1); });

    act(() => { void result.current.start(); });
    await waitFor(() => { expect(capture.open).toHaveBeenCalledTimes(1); });

    act(() => { characterSnapshots[0]!({ visible: false }); });
    await waitFor(() => { expect(capture.close).toHaveBeenCalledTimes(1); });

    await act(async () => {
      opening.resolve({ status: 'opened', sampleRate: 16_000, fallbackToDefault: false });
      await opening.promise;
    });
    await waitFor(() => { expect(capture.close).toHaveBeenCalledTimes(2); });
  });

  it('submits recognized text with a stable optimistic message identity', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        type: 'agent_run',
        session: { id: 'session-1', projectId: 'project-1' },
        userMessage: { messageId: 'message-1' },
        run: { executionId: 'run-1' },
      },
    });
    Object.assign(window.megumi, {
      settings: {
        get: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            status: 'ok',
            settings: {
              modelSelection: { providerId: 'provider-1', modelId: 'model-1' },
              permissions: { mode: 'ask' },
              voice: {
                inputDeviceId: 'default',
                recognitionLanguage: 'zh',
              },
            },
          },
        }),
      },
      session: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          data: { status: 'ok', sessions: [{ id: 'session-1', projectId: 'project-1' }] },
        }),
        message: { send },
      },
    });
    const { result } = renderHook(() => useCharacterVoice('session-1', {
      createCapture: () => fakeCapture(),
    }));

    await act(async () => { await result.current.submitText('语音输入'); });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        text: '语音输入',
        clientMessageId: expect.any(String),
        createdAt: expect.any(String),
      }),
    }));
  });
});
