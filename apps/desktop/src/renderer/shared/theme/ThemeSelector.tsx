import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { cx } from '../ui';
import { themeDefinitions, themeNames } from './theme-tokens';
import { useThemeStore } from './theme-store';

export function ThemeSelector() {
  const currentTheme = useThemeStore((state) => state.theme);
  const persistTheme = useThemeStore((state) => state.persistTheme);

  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-2 sm:grid-cols-2">
      {themeNames.map((themeName) => {
        const definition = themeDefinitions[themeName];
        const selected = currentTheme === themeName;
        const swatchStyle = {
          background: definition.variables['--color-app-bg'],
          borderColor: definition.variables['--color-border-strong'],
        } satisfies CSSProperties;

        return (
          <button
            key={themeName}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => void persistTheme(themeName)}
            className={cx(
              'flex min-h-16 items-center gap-3 rounded-md border px-3 py-2 text-left transition',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
              selected
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text)] hover:border-[var(--color-border-strong)]',
            )}
          >
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 grid-cols-2 overflow-hidden rounded-md border"
              style={swatchStyle}
            >
              <span style={{ background: definition.variables['--color-surface'] }} />
              <span style={{ background: definition.variables['--color-surface-muted'] }} />
              <span style={{ background: definition.variables['--color-accent'] }} />
              <span style={{ background: definition.variables['--color-success'] }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{definition.label}</span>
              <span className="block truncate text-xs text-[var(--color-text-muted)]">{themeName}</span>
            </span>
            {selected ? <Check size={16} aria-hidden="true" className="shrink-0 text-[var(--color-accent)]" /> : null}
          </button>
        );
      })}
    </div>
  );
}
