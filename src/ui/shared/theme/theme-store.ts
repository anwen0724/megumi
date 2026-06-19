import { create } from 'zustand';
import { getMegumiRendererApi } from '../megumi-api';
import type { ThemeName } from './theme-tokens';

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  hydrateFromSettings: () => Promise<void>;
  persistTheme: (theme: ThemeName) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'midnight-blue',
  setTheme: (theme) => set({ theme }),
  async hydrateFromSettings() {
    const megumi = getMegumiRendererApi();
    if (!megumi?.settings?.get) {
      return;
    }
    const result = await megumi.settings.get();
    if (result.ok) {
      set({ theme: result.data.settings.theme });
    }
  },
  async persistTheme(theme) {
    set({ theme });
    const megumi = getMegumiRendererApi();
    if (!megumi?.settings?.update) {
      return;
    }
    const result = await megumi.settings.update({ theme });
    if (result.ok) {
      set({ theme: result.data.settings.theme });
    }
  },
}));
