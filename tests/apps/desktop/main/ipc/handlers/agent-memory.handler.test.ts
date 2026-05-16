import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerAgentMemoryHandlers } from '@megumi/desktop/main/ipc/handlers/agent-memory.handler';
import { runtimeOperationNameFromChannel } from '@megumi/desktop/main/ipc/runtime-operation-name';

describe('registerAgentMemoryHandlers', () => {
  it('registers memory handlers through runtime ipc envelope', async () => {
    const handle = vi.fn();
    const ipcMain = { handle };
    const service = {
      getSettings: vi.fn(() => ({
        workspaceId: 'workspace:1',
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: '2026-05-16T00:00:00.000Z',
      })),
    };

    registerAgentMemoryHandlers({ ipcMain, agentMemoryService: service as any });

    expect(handle).toHaveBeenCalledWith(
      IPC_CHANNELS.agent.memory.settingsGet,
      expect.any(Function),
    );
  });
});

describe('memory runtime operation names', () => {
  it('uses lowercase dotted/kebab operation names', () => {
    expect(runtimeOperationNameFromChannel(IPC_CHANNELS.agent.memory.settingsGet)).toBe(
      'agent.memory.settings.get',
    );
    expect(runtimeOperationNameFromChannel(IPC_CHANNELS.agent.memory.recallPreview)).toBe(
      'agent.memory.recall-preview',
    );
  });
});
