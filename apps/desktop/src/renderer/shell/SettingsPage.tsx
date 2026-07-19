import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Activity, Bot, BrainCircuit, CheckCircle2, Globe2, Info, Palette, ShieldCheck } from 'lucide-react';
import { DiagnosticsPanel } from '../features/observability';
import { MemorySettingsPanel } from '../features/memory-settings';
import { ProviderSettingsPanel } from '../features/provider-settings';
import { WebSettingsPanel } from '../features/web-settings';
import { PermissionRulesPanel } from '../features/permission-settings';
import { ThemeSelector } from '../shared/theme';
import { LanguageSelector } from '../shared/i18n';
import {
  Button,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  cx,
} from '../shared/ui';

type SettingsCategory = 'appearance' | 'models' | 'web' | 'memory' | 'diagnostics' | 'security' | 'about';

interface SettingsPageProps {
  onDone: () => void;
  sidebarWidth?: number;
  onStartSidebarResize?: (event: ReactPointerEvent) => void;
}

interface SettingsCategoryItem {
  id: SettingsCategory;
  icon: typeof Palette;
}

const categoryGroups: Array<{ id: 'personal' | 'aiTools' | 'support'; items: SettingsCategoryItem[] }> = [
  {
    id: 'personal',
    items: [
      { id: 'appearance', icon: Palette },
      { id: 'memory', icon: BrainCircuit },
    ],
  },
  {
    id: 'aiTools',
    items: [
      { id: 'models', icon: Bot },
      { id: 'web', icon: Globe2 },
      { id: 'security', icon: ShieldCheck },
    ],
  },
  {
    id: 'support',
    items: [
      { id: 'diagnostics', icon: Activity },
      { id: 'about', icon: Info },
    ],
  },
];

const categories = categoryGroups.flatMap((group) => group.items);

function activeCategoryLabel(category: SettingsCategory): SettingsCategoryItem {
  return categories.find((item) => item.id === category) ?? categories[0];
}

export function SettingsPage({ onDone, sidebarWidth = 288, onStartSidebarResize }: SettingsPageProps) {
  const { t } = useTranslation('settings');
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
          style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
          className="grid h-full min-h-0 overflow-hidden"
        >
          <aside className="relative border-r border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-4">
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('resizeSidebar')}
              onPointerDown={onStartSidebarResize}
              className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent hover:bg-[var(--color-focus)]/40"
            />
            <div className="mb-5 px-2">
              <p className="text-lg font-semibold tracking-[-0.01em] text-[var(--color-text)]">
                {t('title')}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDone}
              className="mb-5 w-full justify-start"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              {t('backToChat')}
            </Button>
            <nav role="tablist" aria-label={t('categoriesLabel')} className="space-y-5">
              {categoryGroups.map((group) => (
                <div key={group.id} role="presentation">
                  <p className="mb-1.5 px-3 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-subtle)]">
                    {t(`groups.${group.id}`)}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((item) => {
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
                            'relative flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
                            selected
                              ? 'bg-[var(--color-surface)] font-medium text-[var(--color-text)] shadow-sm'
                              : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/70 hover:text-[var(--color-text)]',
                          )}
                        >
                          {selected ? (
                            <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--color-accent)]" />
                          ) : null}
                          <Icon
                            size={16}
                            aria-hidden="true"
                            className={selected ? 'text-[var(--color-accent)]' : undefined}
                          />
                          <span className="truncate">{t(`categories.${item.id}.label`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          <section
            role="tabpanel"
            aria-label={t(`categories.${activeCategory.id}.label`)}
            className="min-w-0 overflow-y-auto px-8 py-8"
          >
            <div className="mx-auto max-w-5xl">
              {category === 'appearance' ? (
                <div className="space-y-6">
                  <SettingsPageHeader
                    title={t('categories.appearance.label')}
                    description={t('categories.appearance.description')}
                  />
                  <SettingsSection
                    title={t('appearance.languageTitle')}
                    description={t('appearance.languageDescription')}
                  >
                    <div className="p-5">
                      <LanguageSelector />
                    </div>
                  </SettingsSection>
                  <SettingsSection
                    title={t('appearance.themeTitle')}
                    description={t('appearance.themeDescription')}
                  >
                    <div className="p-5">
                      <ThemeSelector />
                    </div>
                  </SettingsSection>
                </div>
              ) : null}

              {category === 'models' ? <ProviderSettingsPanel /> : null}

              {category === 'web' ? <WebSettingsPanel /> : null}

              {category === 'memory' ? <MemorySettingsPanel /> : null}

              {category === 'diagnostics' ? <DiagnosticsPanel /> : null}

              {category === 'security' ? (
                <div className="space-y-6">
                  <SettingsPageHeader
                    title={t('categories.security.label')}
                    description={t('categories.security.description')}
                  />
                  <SettingsSection title={t('security.protections')}>
                    <SettingsRow
                      title={t('security.apiKeyStorage')}
                      description={t('security.apiKeyDescription')}
                    >
                      <div className="flex items-center justify-end gap-2 text-sm font-medium text-[var(--color-success)]">
                        <CheckCircle2 size={16} aria-hidden="true" />
                        {t('security.protected')}
                      </div>
                    </SettingsRow>
                  </SettingsSection>
                  <PermissionRulesPanel />
                </div>
              ) : null}

              {category === 'about' ? (
                <div className="space-y-6">
                  <SettingsPageHeader
                    title={t('categories.about.label')}
                    description={t('categories.about.description')}
                  />
                  <SettingsSection>
                    <div className="flex items-start gap-4 p-5">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                        <CheckCircle2 size={20} aria-hidden="true" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-[var(--color-text)]">Megumi</h2>
                        <p className="mt-1 text-sm text-[var(--color-text)]">
                          {t('about.tagline')}
                        </p>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
                          {t('about.description')}
                        </p>
                      </div>
                    </div>
                  </SettingsSection>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
