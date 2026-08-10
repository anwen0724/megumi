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
      prepareModels: vi.fn(),
      cancelModelPreparation: vi.fn(),
      listProfiles: vi.fn(),
      importProfile: vi.fn(),
      renameProfile: vi.fn(),
      removeProfile: vi.fn(),
      selectProfile: vi.fn(),
      startSession: vi.fn(),
      setMuted: vi.fn(),
      interrupt: vi.fn(),
      endSession: vi.fn(),
    };

    registerVoiceHandlers({ host: { voice } as never }, { ipcMain: { handle } });

    expect(handle.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.voice.snapshot,
      IPC_CHANNELS.voice.modelStatus,
      IPC_CHANNELS.voice.modelsPrepare,
      IPC_CHANNELS.voice.modelsCancel,
      IPC_CHANNELS.voice.profilesList,
      IPC_CHANNELS.voice.profileImport,
      IPC_CHANNELS.voice.profileRename,
      IPC_CHANNELS.voice.profileRemove,
      IPC_CHANNELS.voice.profileSelect,
      IPC_CHANNELS.voice.sessionStart,
      IPC_CHANNELS.voice.sessionMute,
      IPC_CHANNELS.voice.sessionInterrupt,
      IPC_CHANNELS.voice.sessionEnd,
    ]);
  });
});
