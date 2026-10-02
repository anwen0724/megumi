/* Owns the bootstrap, optimistic selection, and Settings persistence of Permission Mode. */
import { create } from 'zustand';
import type { PermissionMode } from '@megumi/application/contracts';
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
    const baseline = await window.megumi.settings.readSettings();
    if (!baseline.ok) return;
    const result = await window.megumi.settings.updateSettings({
      patch: { permissions: { mode } }, expectedRevision: baseline.data.revision,
    });
    if (result.ok) set({ mode: result.data.settings.config.permissions.mode });
  },
}));
