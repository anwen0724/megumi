// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerVoiceHandlers } from '@megumi/desktop/main/ipc/handlers/voice.handler';

describe('registerVoiceHandlers', () => {
  it('registers VoiceHost operations as strict business IPC handlers', () => {
    const handle = vi.fn();
    const voice = {
      getSnapshot: vi.fn(),
      getModelStatus: vi.fn(),
      getModelCapabilityStatus: vi.fn(),
      checkModelUpdates: vi.fn(),
      prepareModels: vi.fn(),
      cancelModelPreparation: vi.fn(),
      startSession: vi.fn(),
      startManualUtterance: vi.fn(),
      finishManualUtterance: vi.fn(),
      setMuted: vi.fn(),
      endSession: vi.fn(),
      stopSpeechOutput: vi.fn(),
    };

    registerVoiceHandlers({ host: { voice } as never }, { ipcMain: { handle } });

    expect(handle.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.voice.snapshot,
      IPC_CHANNELS.voice.modelStatus,
      IPC_CHANNELS.voice.modelCapability,
      IPC_CHANNELS.voice.modelsCheckUpdates,
      IPC_CHANNELS.voice.modelsPrepare,
      IPC_CHANNELS.voice.modelsCancel,
      IPC_CHANNELS.voice.sessionStart,
      IPC_CHANNELS.voice.sessionManualStart,
      IPC_CHANNELS.voice.sessionManualFinish,
      IPC_CHANNELS.voice.sessionMute,
      IPC_CHANNELS.voice.sessionEnd,
      IPC_CHANNELS.voice.speechOutputStop,
    ]);
  });
});
