import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx } from '../ui';
import { themeDefinitions, themeNames } from './theme-tokens';
import { useThemeStore } from './theme-store';

export function ThemeSelector() {
  const { t } = useTranslation('common');
  const currentTheme = useThemeStore((state) => state.theme);
  const persistTheme = useThemeStore((state) => state.persistTheme);

  return (
    <div role="radiogroup" aria-label={t('theme.label')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {themeNames.map((themeName) => {
        const definition = themeDefinitions[themeName];
        const label = t(`theme.names.${themeName}`);
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
            aria-label={selected ? t('theme.current', { theme: label }) : label}
            onClick={() => void persistTheme(themeName)}
            className={cx(
              'group flex min-h-24 cursor-pointer flex-col items-stretch overflow-hidden rounded-xl border text-left transition-colors duration-150',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
              selected
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)] ring-1 ring-[var(--color-accent)]/20'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]',
            )}
          >
            <span
              aria-hidden="true"
              className="grid h-12 w-full grid-cols-[1.4fr_1fr_0.65fr] overflow-hidden border-b"
              style={swatchStyle}
            >
              <span style={{ background: definition.variables['--color-surface'] }} />
              <span style={{ background: definition.variables['--color-surface-muted'] }} />
              <span style={{ background: definition.variables['--color-accent'] }} />
            </span>
            <span className="flex min-w-0 items-center gap-2 px-3 py-2.5">
              <span className="block min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
              {selected ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]">
                  <Check size={14} aria-hidden="true" />
                  {t('actions.current')}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
