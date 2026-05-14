import { Palette } from 'lucide-react';
import { IconButton } from '../ui';
import { getNextThemeName, getThemeDefinition } from './theme-tokens';
import { useThemeStore } from './theme-store';

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const currentTheme = getThemeDefinition(theme);
  const nextTheme = getThemeDefinition(getNextThemeName(theme));

  return (
    <div className="flex items-center gap-2">
      <IconButton label={`Switch to ${nextTheme.label} theme`} onClick={toggleTheme} variant="ghost" size="sm">
        <Palette size={16} aria-hidden="true" />
      </IconButton>
      <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">{currentTheme.label}</span>
    </div>
  );
}
