import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../ipc';
import type { ThemeName } from './theme-tokens';

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  applyBootstrapTheme: (theme: ThemeName) => void;
  persistTheme: (theme: ThemeName) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'midnight-blue',
  setTheme: (theme) => set({ theme }),
  applyBootstrapTheme: (theme) => set({ theme }),
  async persistTheme(theme) {
    const baseline = await window.megumi.settings.readSettings();
    if (!baseline.ok) return;
    const result = await window.megumi.settings.updateSettings({
      patch: { general: { theme } },
      expectedRevision: baseline.data.revision,
    });
    if (result.ok) set({ theme: result.data.settings.config.general.theme });
  },
}));
