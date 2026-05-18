import { Palette } from 'lucide-react';
import { IconButton } from '../ui';
import { getNextThemeName, getThemeDefinition } from './theme-tokens';
import { useThemeStore } from './theme-store';

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const nextTheme = getThemeDefinition(getNextThemeName(theme));

  return (
    <IconButton label={`Switch to ${nextTheme.label} theme`} onClick={toggleTheme} variant="ghost" size="sm">
      <Palette size={16} aria-hidden="true" />
    </IconButton>
  );
}
