import { create } from 'zustand';
import { getNextThemeName, type ThemeName } from './theme-tokens';

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'megumi-warm',
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: getNextThemeName(state.theme) })),
}));
