import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, BrainCircuit, CheckCircle2, Info, Palette, ShieldCheck } from 'lucide-react';
import { MemorySettingsPanel } from '../features/memory-settings';
import { ProviderSettingsPanel } from '../features/provider-settings';
import { ThemeSelector } from '../shared/theme';
import { Button, cx } from '../shared/ui';

type SettingsCategory = 'appearance' | 'models' | 'memory' | 'security' | 'about';

interface SettingsPageProps {
  onDone: () => void;
}

interface SettingsCategoryItem {
  id: SettingsCategory;
  label: string;
  icon: typeof Palette;
  description: string;
}

const categories: SettingsCategoryItem[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and local display preferences' },
  { id: 'models', label: 'Models', icon: Bot, description: 'Provider and model runtime settings' },
  { id: 'memory', label: 'Memory', icon: BrainCircuit, description: 'Global long-term memory runtime settings' },
  { id: 'security', label: 'Security', icon: ShieldCheck, description: 'Local secret and approval posture' },
  { id: 'about', label: 'About', icon: Info, description: 'Megumi desktop runtime information' },
];

function activeCategoryLabel(category: SettingsCategory): SettingsCategoryItem {
  return categories.find((item) => item.id === category) ?? categories[0];
}

export function SettingsPage({ onDone }: SettingsPageProps) {
  const [category, setCategory] = useState<SettingsCategory>('appearance');
  const activeCategory = activeCategoryLabel(category);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onDone();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDone]);

  return (
    <main
      data-testid="settings-page"
      className="min-w-[42rem] flex-1 overflow-hidden bg-[var(--color-app-bg)]"
    >
      <div className="h-full">
        <div
          data-testid="settings-page-content"
          className="grid h-full min-h-0 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden"
        >
          <aside className="border-r border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDone}
              className="mb-3 w-full justify-start"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back to chat
            </Button>
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
                      'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
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

          <section
            role="tabpanel"
            aria-label={activeCategory.label}
            className="min-w-0 overflow-y-auto px-8 py-6"
          >
            <div className="mx-auto max-w-4xl">
              <div className="mb-5">
                <p className="text-sm font-semibold text-[var(--color-text)]">{activeCategory.label}</p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{activeCategory.description}</p>
              </div>

              {category === 'appearance' ? (
                <div className="space-y-4">
                  <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h2 className="text-sm font-semibold text-[var(--color-text)]">Theme</h2>
                    <div className="mt-3">
                      <ThemeSelector />
                    </div>
                  </section>
                </div>
              ) : null}

              {category === 'models' ? <ProviderSettingsPanel /> : null}

              {category === 'memory' ? <MemorySettingsPanel /> : null}

              {category === 'security' ? (
                <div className="space-y-3">
                  <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h2 className="text-sm font-semibold text-[var(--color-text)]">Secret storage</h2>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      Provider API keys are encrypted by the Electron main process and are never exposed back to the renderer.
                    </p>
                  </section>
                  <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h2 className="text-sm font-semibold text-[var(--color-text)]">Approval policies</h2>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      Tool approvals are still deferred until the tool runtime phase.
                    </p>
                  </section>
                </div>
              ) : null}

              {category === 'about' ? (
                <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--color-success)]" />
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--color-text)]">Megumi</h2>
                      <p className="mt-1 text-sm text-[var(--color-text)]">AI provider chat runtime integration</p>
                      <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                        This build connects the desktop UI to provider-backed streaming chat.
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
