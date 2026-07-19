/* Owns the bootstrap, optimistic selection, and Settings persistence of Permission Mode. */
import { create } from 'zustand';
import type { PermissionMode } from '@megumi/product/host-interface';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';

interface PermissionModeState {
  mode: PermissionMode;
  applyBootstrapMode(mode: PermissionMode): void;
  persistMode(mode: PermissionMode): Promise<void>;
}

export const usePermissionModeStore = create<PermissionModeState>((set) => ({
  mode: 'ask',
  applyBootstrapMode: (mode) => set({ mode }),
  async persistMode(mode) {
    set({ mode });
    if (!window.megumi?.settings?.update) return;
    const result = await window.megumi.settings.update(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, { permissions: { mode } }),
    );
    if (result.ok && result.data.status === 'updated') set({ mode: result.data.settings.permissions.mode });
  },
}));
