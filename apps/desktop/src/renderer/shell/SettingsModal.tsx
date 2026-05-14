import { useEffect, useState } from 'react';
import { Bot, Info, Palette, ShieldCheck, X } from 'lucide-react';
import { ProviderSettingsPanel } from '../features/provider-settings';
import { ThemeToggle, getThemeDefinition, useThemeStore } from '../shared/theme';
import { Button, IconButton, cx } from '../shared/ui';

type SettingsCategory = 'appearance' | 'models' | 'security' | 'about';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface SettingsCategoryItem {
  id: SettingsCategory;
  label: string;
  icon: typeof Palette;
}

const categories: SettingsCategoryItem[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'models', label: 'Models', icon: Bot },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'about', label: 'About', icon: Info },
];

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [category, setCategory] = useState<SettingsCategory>('appearance');
  const theme = useThemeStore((state) => state.theme);
  const currentTheme = getThemeDefinition(theme);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) {
      setCategory('appearance');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Close settings overlay"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/20"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-testid="settings-modal-panel"
        onClick={(event) => event.stopPropagation()}
        className={cx(
          'relative flex h-[560px] max-h-[min(760px,calc(100vh-48px))] w-full max-w-4xl overflow-hidden rounded-xl',
          'border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)]',
        )}
      >
        <aside className="w-48 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
          <div className="mb-4 px-2">
            <h2 id="settings-title" className="text-base font-semibold text-[var(--color-text)]">
              Settings
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Local desktop preferences</p>
          </div>

          <nav role="tablist" aria-label="Settings categories" className="space-y-1">
            {categories.map((item) => {
              const Icon = item.icon;
              const selected = category === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setCategory(item.id)}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
                    selected
                      ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]',
                  )}
                >
                  <Icon size={15} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {categories.find((item) => item.id === category)?.label}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {category === 'models' ? 'Provider and model runtime settings' : 'Local desktop preferences'}
              </p>
            </div>
            <IconButton label="Close settings" onClick={onClose} variant="ghost" size="sm">
              <X size={16} aria-hidden="true" />
            </IconButton>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {category === 'appearance' ? (
              <div className="space-y-4">
                <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-text)]">Current theme</h3>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{currentTheme.label}</p>
                    </div>
                    <ThemeToggle />
                  </div>
                </section>
              </div>
            ) : null}

            {category === 'models' ? <ProviderSettingsPanel /> : null}

            {category === 'security' ? (
              <div className="space-y-3">
                <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Secret storage</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Provider API keys are encrypted by the Electron main process and are never exposed back to the renderer.
                  </p>
                </section>
                <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Approval policies</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Tool approvals are still deferred until the tool runtime phase.
                  </p>
                </section>
              </div>
            ) : null}

            {category === 'about' ? (
              <div className="space-y-4">
                <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Megumi</h3>
                  <p className="mt-1 text-sm text-[var(--color-text)]">AI provider chat runtime integration</p>
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                    This build connects the desktop UI to provider-backed streaming chat.
                  </p>
                </section>
              </div>
            ) : null}
          </div>

          <footer className="flex justify-end border-t border-[var(--color-border)] px-5 py-4">
            <Button onClick={onClose} variant="secondary" size="sm">
              Close
            </Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
