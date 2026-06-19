import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { getThemeDefinition } from './theme-tokens';
import { useThemeStore } from './theme-store';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useThemeStore((state) => state.theme);
  const hydrateFromSettings = useThemeStore((state) => state.hydrateFromSettings);
  const definition = getThemeDefinition(theme);

  useEffect(() => {
    void hydrateFromSettings();
  }, [hydrateFromSettings]);

  return (
    <div
      data-testid="megumi-theme-root"
      data-theme={theme}
      style={definition.variables as CSSProperties}
      className="min-h-screen bg-[var(--color-app-bg)] text-[var(--color-text)]"
    >
      {children}
    </div>
  );
}
