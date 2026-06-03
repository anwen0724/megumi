import { create } from 'zustand';
import type { ThemeName } from './theme-tokens';

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'megumi-warm',
  setTheme: (theme) => set({ theme }),
}));
