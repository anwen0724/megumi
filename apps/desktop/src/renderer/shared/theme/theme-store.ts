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
    set({ theme });
    if (!window.megumi?.settings?.update) {
      return;
    }
    const result = await window.megumi.settings.update(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, { theme }),
    );
    if (result.ok && result.data.status === 'updated') {
      set({ theme: result.data.settings.theme });
    }
  },
}));
