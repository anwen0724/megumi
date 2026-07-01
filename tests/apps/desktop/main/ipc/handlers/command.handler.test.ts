// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { registerCommandHandlers } from '@megumi/desktop/main/ipc/handlers/command.handler';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('registerCommandHandlers', () => {
  beforeEach(async () => {
    const { ipcMain } = await import('electron');
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers the command suggestions IPC channel', async () => {
    const { ipcMain } = await import('electron');

    registerCommandHandlers({
      getCommandSuggestions: vi.fn(() => ({ type: 'inactive' as const })),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.command.suggestions,
      expect.any(Function),
    );
  });

  it('returns command suggestions from the command service', async () => {
    const { ipcMain } = await import('electron');
    const service = {
      getCommandSuggestions: vi.fn(() => ({
        type: 'suggestions' as const,
        draft_input: '/',
        command_prefix: '',
        groups: [{
          id: 'commands',
          label: 'Commands',
          items: [{
            name: 'review',
            description: 'Evaluate review feedback before implementing changes',
            source: { kind: 'built_in' as const },
            match: { field: 'name' as const, value: 'review', prefix: '' },
            completion: { replacement_input: '/review ' },
          }],
        }],
      })),
    };

    registerCommandHandlers(service);
    const handler = vi.mocked(ipcMain.handle).mock.calls[0]?.[1];
    const result = await handler?.({} as Electron.IpcMainInvokeEvent, {
      requestId: 'ipc-command-suggestions-1',
      payload: {
        draft_input: '/',
      },
      meta: {
        channel: IPC_CHANNELS.command.suggestions,
        createdAt: '2026-05-18T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(service.getCommandSuggestions).toHaveBeenCalledWith({ draft_input: '/' });
    expect(result).toMatchObject({
      ok: true,
      data: {
        suggestions: {
          type: 'suggestions',
          groups: [{
            id: 'commands',
            items: [{
              name: 'review',
            }],
          }],
        },
      },
      meta: {
        requestId: 'ipc-command-suggestions-1',
        channel: IPC_CHANNELS.command.suggestions,
      },
    });
  });
});
