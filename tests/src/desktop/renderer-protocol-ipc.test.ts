// Verifies renderer protocol IPC failures and workspace file DTO mapping at the desktop boundary.
import { describe, expect, it, vi } from 'vitest';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
import { registerDesktopIpcHandlers } from '../../../src/desktop/ipc/register-handlers';
import { handleWorkspaceFilesOperation } from '../../../src/desktop/ipc/workspace-files.handler';
import { IPC_CHANNELS } from '../../../src/shared/renderer-contracts/ipc';
import { createRendererRuntimeIpcRequest } from '../../../src/ui/shared/ipc/runtime-request';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

async function registeredInvokeHandler() {
  const { ipcMain } = await import('electron');
  return vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'megumi:invoke')?.[1];
}

function createIpcContext(overrides: Partial<DesktopIpcContext> = {}): DesktopIpcContext {
  return {
    appApi: {} as never,
    hosts: {
      shellHost: {
        openPath: vi.fn(async () => undefined),
      },
    } as never,
    getMainWindow: () => undefined,
    ...overrides,
  };
}

describe('renderer protocol desktop IPC failures', () => {
  it('returns typed failures for deferred artifact and memory backends', async () => {
    const { ipcMain } = await import('electron');
    vi.mocked(ipcMain.handle).mockClear();
    registerDesktopIpcHandlers(createIpcContext());
    const handler = await registeredInvokeHandler();

    await expect(handler?.({} as never, { operation: 'artifacts.list' })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'desktop_capability_unavailable',
        details: expect.objectContaining({ operation: 'artifacts.list' }),
      }),
    });
    await expect(handler?.({} as never, { operation: 'memory.getSettings' })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'desktop_capability_unavailable',
        details: expect.objectContaining({ operation: 'memory.getSettings' }),
      }),
    });
  });

  it('returns a typed failure for unsupported renderer operations', async () => {
    const { ipcMain } = await import('electron');
    vi.mocked(ipcMain.handle).mockClear();
    registerDesktopIpcHandlers(createIpcContext());
    const handler = await registeredInvokeHandler();

    await expect(handler?.({} as never, { operation: 'unknown.operation' })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'desktop_operation_unsupported',
        details: expect.objectContaining({ operation: 'unknown.operation' }),
      }),
    });
  });
});

describe('workspace files renderer protocol', () => {
  it('unwraps workspace.files.list runtime requests and returns renderer directory entries', async () => {
    const workspaceManager = {
      listDirectory: vi.fn(async () => [
        { name: 'src', path: 'src', kind: 'directory' },
        { name: 'a.ts', path: 'src/a.ts', kind: 'file' },
      ]),
    };
    const context = createIpcContext({
      runtime: {
        workspaceManager,
      } as never,
    });
    const result = await handleWorkspaceFilesOperation(
      'workspace.files.list',
      createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.files.list, {
        workspaceRoot: 'C:/repo',
        directoryPath: 'src',
      }),
      context,
    );

    expect(workspaceManager.listDirectory).toHaveBeenCalledWith('src');
    expect(result).toEqual({
      workspaceRoot: 'C:/repo',
      directoryPath: 'src',
      entries: [
        { name: 'src', relativePath: 'src', path: 'src', kind: 'directory', depth: 1 },
        { name: 'a.ts', relativePath: 'src/a.ts', path: 'src/a.ts', kind: 'file', depth: 2 },
      ],
    });
  });

  it('unwraps workspace.files.open runtime requests and fails when filePath is missing', async () => {
    const shellHost = { openPath: vi.fn(async () => undefined) };
    const context = createIpcContext({
      hosts: { shellHost } as never,
    });

    await expect(handleWorkspaceFilesOperation(
      'workspace.files.open',
      createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.files.open, {
        workspaceRoot: 'C:/repo',
        filePath: 'src/a.ts',
      }),
      context,
    )).resolves.toEqual({
      workspaceRoot: 'C:/repo',
      filePath: 'src/a.ts',
      opened: true,
    });
    expect(shellHost.openPath).toHaveBeenCalledWith('C:\\repo\\src\\a.ts');

    await expect(handleWorkspaceFilesOperation(
      'workspace.files.open',
      createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.files.open, {
        workspaceRoot: 'C:/repo',
      }),
      context,
    )).rejects.toMatchObject({
      code: 'desktop_capability_unavailable',
      details: expect.objectContaining({ operation: 'workspace.files.open' }),
    });
  });
});
