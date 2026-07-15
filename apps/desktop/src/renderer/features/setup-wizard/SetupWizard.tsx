/*
 * Renders Megumi's blocking first-run experience.
 * Catalog-backed provider choices keep onboarding aligned with Settings without duplicating provider facts.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Palette,
  Sparkles,
} from 'lucide-react';
import type { AppLanguage, ProviderCatalogUiDto } from '@megumi/product/host-interface';
import { useProviderStore } from '../../entities/provider';
import { Button, TextField, cx } from '../../shared/ui';
import { applyRendererLanguage, localizeRendererError } from '../../shared/i18n';
import { themeDefinitions, themeNames, useThemeStore, type ThemeName } from '../../shared/theme';
import { useSetupWizardStore } from './setup-wizard-store';

type Step = 'preferences' | 'provider' | 'ready';

export function SetupWizard() {
  const { t } = useTranslation(['setup', 'common']);
  const status = useSetupWizardStore((state) => state.status);
  const bootstrapLanguage = useSetupWizardStore((state) => state.language);
  const error = useSetupWizardStore((state) => state.error);
  const completeSetup = useSetupWizardStore((state) => state.completeSetup);
  const catalog = useProviderStore((state) => state.catalog);
  const providerStatus = useProviderStore((state) => state.status);
  const providerError = useProviderStore((state) => state.error);
  const loadProviders = useProviderStore((state) => state.loadProviders);
  const applyTheme = useThemeStore((state) => state.setTheme);

  const [step, setStep] = useState<Step>('preferences');
  const [language, setLanguage] = useState<AppLanguage>(bootstrapLanguage);
  const [theme, setTheme] = useState<ThemeName>(() => useThemeStore.getState().theme);
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [skipProvider, setSkipProvider] = useState(false);

  const selectedProvider = useMemo(
    () => catalog.find((provider) => provider.providerId === providerId),
    [catalog, providerId],
  );
  const selectedModel = selectedProvider?.models.find((model) => model.modelId === modelId);
  const saving = status === 'saving';
  const providerComplete = Boolean(providerId && modelId && apiKey.trim());
  const steps: Array<{ id: Step; label: string; description: string }> = [
    { id: 'preferences', label: t('setup:steps.preferences.label'), description: t('setup:steps.preferences.description') },
    { id: 'provider', label: t('setup:steps.provider.label'), description: t('setup:steps.provider.description') },
    { id: 'ready', label: t('setup:steps.ready.label'), description: t('setup:steps.ready.description') },
  ];
  const languageOptions: Array<{ id: AppLanguage; label: string; detail: string }> = [
    { id: 'zh-CN', label: t('common:language.chinese'), detail: t('common:language.chineseDetail') },
    { id: 'en-US', label: t('common:language.english'), detail: t('common:language.englishDetail') },
  ];

  useEffect(() => {
    if (providerStatus === 'idle') {
      void loadProviders();
    }
  }, [loadProviders, providerStatus]);

  useEffect(() => {
    if (providerId || catalog.length === 0) return;
    selectProvider(catalog[0]);
  }, [catalog, providerId]);

  function selectProvider(provider: ProviderCatalogUiDto) {
    setProviderId(provider.providerId);
    setBaseUrl(provider.defaultBaseUrl);
    setModelId(provider.models[0]?.modelId ?? '');
    setSkipProvider(false);
  }

  function handleThemeChange(nextTheme: ThemeName) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  function handleLanguageChange(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage);
    void applyRendererLanguage(nextLanguage);
  }

  async function handleFinish() {
    await completeSetup({
      language,
      theme,
      ...(skipProvider
        ? { modelIds: [], skipProvider: true }
        : {
            providerId,
            baseUrl,
            modelIds: [modelId],
            apiKey,
          }),
    });
    if (useSetupWizardStore.getState().setupCompleted === true) {
      setApiKey('');
    }
  }

  return (
    <main
      data-testid="setup-wizard"
      className="flex min-h-0 flex-1 overflow-hidden bg-[var(--color-app-bg)] [&_button:not(:disabled)]:cursor-pointer"
    >
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-7 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
            <Sparkles size={17} className="text-[var(--color-accent)]" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight text-[var(--color-text)]">Megumi</p>
            <p className="text-xs text-[var(--color-text-muted)]">{t('setup:branding.subtitle')}</p>
          </div>
        </div>

        <nav className="mt-12 space-y-1" aria-label={t('setup:progressLabel')}>
          {steps.map((item, index) => {
            const currentIndex = steps.findIndex((candidate) => candidate.id === step);
            const complete = index < currentIndex;
            const active = item.id === step;
            return (
              <div
                key={item.id}
                className={cx(
                  'flex gap-3 rounded-lg px-3 py-2.5 transition-colors',
                  active ? 'bg-[var(--color-accent-soft)]' : 'text-[var(--color-text-muted)]',
                )}
              >
                <span
                  className={cx(
                    'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold',
                    active || complete
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                      : 'border-[var(--color-border-strong)]',
                  )}
                >
                  {complete ? <Check size={13} aria-hidden="true" /> : index + 1}
                </span>
                <span>
                  <span className={cx('block text-sm font-medium', active && 'text-[var(--color-text)]')}>{item.label}</span>
                  <span className="mt-0.5 block text-xs">{item.description}</span>
                </span>
              </div>
            );
          })}
        </nav>

        <p className="mt-auto text-xs leading-5 text-[var(--color-text-subtle)]">
          {t('setup:branding.privacy')}
        </p>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-12">
          <div className="mb-9 lg:hidden">
            <p className="text-sm font-semibold text-[var(--color-text)]">Megumi</p>
            <div className="mt-4 flex gap-2" aria-label={t('setup:progressLabel')}>
              {steps.map((item) => (
                <span
                  key={item.id}
                  className={cx(
                    'h-1 flex-1 rounded-full',
                    steps.findIndex((candidate) => candidate.id === item.id) <= steps.findIndex((candidate) => candidate.id === step)
                      ? 'bg-[var(--color-accent)]'
                      : 'bg-[var(--color-border)]',
                  )}
                />
              ))}
            </div>
          </div>

          <div key={step} className="animate-[megumi-message-in_160ms_ease-out]">
            {step === 'preferences' ? (
              <PreferencesStep
                language={language}
                theme={theme}
                onLanguageChange={handleLanguageChange}
                languageOptions={languageOptions}
                onThemeChange={handleThemeChange}
              />
            ) : null}
            {step === 'provider' ? (
              <ProviderStep
                catalog={catalog}
                loading={providerStatus === 'idle' || providerStatus === 'loading'}
                error={providerError ? localizeRendererError(providerError) : null}
                providerId={providerId}
                modelId={modelId}
                baseUrl={baseUrl}
                apiKey={apiKey}
                showApiKey={showApiKey}
                onProviderChange={selectProvider}
                onModelChange={setModelId}
                onBaseUrlChange={setBaseUrl}
                onApiKeyChange={setApiKey}
                onToggleApiKey={() => setShowApiKey((current) => !current)}
              />
            ) : null}
            {step === 'ready' ? (
              <ReadyStep
                language={languageOptions.find((option) => option.id === language)?.label ?? t('common:language.english')}
                theme={t(`common:theme.names.${theme}`)}
                provider={skipProvider ? undefined : selectedProvider?.displayName}
                model={skipProvider ? undefined : selectedModel?.displayName ?? modelId}
              />
            ) : null}
          </div>

          {(error || (providerError && step === 'provider')) ? (
            <p className="mt-6 rounded-xl border border-[var(--color-danger)]/60 bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
              {error ? localizeRendererError(error) : providerError ? localizeRendererError(providerError) : null}
            </p>
          ) : null}

          <div className="mt-8 flex items-center justify-between border-t border-[var(--color-border)] pt-6">
            {step === 'preferences' ? <span /> : (
              <Button
                variant="ghost"
                className="h-11"
                disabled={saving}
                onClick={() => setStep(step === 'ready' ? 'provider' : 'preferences')}
              >
                {t('common:actions.back')}
              </Button>
            )}

            {step === 'preferences' ? (
              <Button variant="primary" className="h-11 min-w-28" onClick={() => setStep('provider')}>
                {t('common:actions.continue')} <ChevronRight size={15} aria-hidden="true" />
              </Button>
            ) : null}

            {step === 'provider' ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  className="h-11"
                  disabled={saving}
                  onClick={() => {
                    setSkipProvider(true);
                    setStep('ready');
                  }}
                >
                  {t('setup:actions.setupLater')}
                </Button>
                <Button
                  variant="primary"
                  className="h-11 min-w-28"
                  disabled={!providerComplete || saving}
                  onClick={() => {
                    setSkipProvider(false);
                    setStep('ready');
                  }}
                >
                  {t('common:actions.continue')} <ChevronRight size={15} aria-hidden="true" />
                </Button>
              </div>
            ) : null}

            {step === 'ready' ? (
              <Button variant="primary" className="h-11 min-w-40" disabled={saving} onClick={() => void handleFinish()}>
                {saving ? t('setup:actions.saving') : t('setup:actions.start')}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function StepHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="mb-7 max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-text)]">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
    </header>
  );
}

function PreferencesStep({
  language,
  theme,
  onLanguageChange,
  onThemeChange,
  languageOptions,
}: {
  language: AppLanguage;
  theme: ThemeName;
  onLanguageChange: (language: AppLanguage) => void;
  onThemeChange: (theme: ThemeName) => void;
  languageOptions: Array<{ id: AppLanguage; label: string; detail: string }>;
}) {
  const { t } = useTranslation(['setup', 'common']);
  return (
    <div>
      <StepHeading
        eyebrow={t('setup:preferences.eyebrow')}
        title={t('setup:preferences.title')}
        description={t('setup:preferences.description')}
      />

      <div className="space-y-7">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text)]">{t('common:language.label')}</span>
            <span className="text-xs text-[var(--color-text-muted)]">{t('setup:preferences.languageHint')}</span>
          </div>
          <div className="max-w-sm">
            {languageOptions.map((option) => {
              const selected = language === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onLanguageChange(option.id)}
                  className={cx(
                    'flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]',
                    selected
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]',
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold text-[var(--color-text)]">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{option.detail}</span>
                  </span>
                  {selected ? <Check size={17} className="text-[var(--color-accent)]" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <Palette size={16} aria-hidden="true" /> {t('setup:preferences.appearance')}
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {themeNames.map((themeName) => {
              const definition = themeDefinitions[themeName];
              const themeLabel = t(`common:theme.names.${themeName}`);
              const selected = theme === themeName;
              const colors = [
                definition.variables['--color-app-bg'],
                definition.variables['--color-surface'],
                definition.variables['--color-accent'],
              ];
              return (
                <button
                  key={themeName}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={themeLabel}
                  onClick={() => onThemeChange(themeName)}
                  className={cx(
                    'group rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]',
                    selected
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]',
                  )}
                >
                  <span className="flex h-7 overflow-hidden rounded-md border border-black/10">
                    {colors.map((color, index) => <span key={`${color}-${index}`} className="flex-1" style={{ backgroundColor: color }} />)}
                  </span>
                  <span className="mt-2 flex items-center justify-between text-xs font-medium text-[var(--color-text)]">
                    {themeLabel}
                    {selected ? <Check size={15} className="text-[var(--color-accent)]" aria-hidden="true" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderStep({
  catalog,
  loading,
  error,
  providerId,
  modelId,
  baseUrl,
  apiKey,
  showApiKey,
  onProviderChange,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onToggleApiKey,
}: {
  catalog: ProviderCatalogUiDto[];
  loading: boolean;
  error: string | null;
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  showApiKey: boolean;
  onProviderChange: (provider: ProviderCatalogUiDto) => void;
  onModelChange: (modelId: string) => void;
  onBaseUrlChange: (baseUrl: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onToggleApiKey: () => void;
}) {
  const { t } = useTranslation('setup');
  const provider = catalog.find((candidate) => candidate.providerId === providerId);
  return (
    <div>
      <StepHeading
        eyebrow={t('provider.eyebrow')}
        title={t('provider.title')}
        description={t('provider.description')}
      />

      <div className="space-y-6">
        <div>
          <p className="mb-3 text-sm font-semibold text-[var(--color-text)]">{t('provider.label')}</p>
          {loading ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5 text-sm text-[var(--color-text-muted)]">
              {t('provider.loading')}
            </div>
          ) : null}
          {!loading && !error ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {catalog.map((candidate) => {
                const selected = providerId === candidate.providerId;
                return (
                  <button
                    key={candidate.providerId}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onProviderChange(candidate)}
                    className={cx(
                    'flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]',
                    selected
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]',
                    )}
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--color-surface-elevated)] text-[var(--color-accent)]">
                      <Bot size={19} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--color-text)]">{candidate.displayName}</span>
                      <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{t('provider.modelCount', { count: candidate.models.length })}</span>
                    </span>
                    {selected ? <Check size={17} className="text-[var(--color-accent)]" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {provider ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium text-[var(--color-text-muted)]">
                {t('provider.defaultModel')}
                <span className="relative block">
                  <select
                    aria-label={t('provider.defaultModel')}
                    value={modelId}
                    onChange={(event) => onModelChange(event.target.value)}
                    className="h-11 w-full appearance-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 pr-9 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
                  >
                    {provider.models.map((model) => <option key={model.modelId} value={model.modelId}>{model.displayName}</option>)}
                  </select>
                  <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
                </span>
              </label>

              <div className="space-y-1.5">
                <label htmlFor="setup-api-key" className="text-xs font-medium text-[var(--color-text-muted)]">{t('provider.apiKey')}</label>
                <span className="relative block">
                  <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" aria-hidden="true" />
                  <input
                    id="setup-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => onApiKeyChange(event.target.value)}
                    placeholder={t('provider.apiKeyPlaceholder')}
                    autoComplete="off"
                    className="h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] pl-9 pr-12 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
                  />
                  <button
                    type="button"
                    aria-label={showApiKey ? t('provider.hideApiKey') : t('provider.showApiKey')}
                    onClick={onToggleApiKey}
                    className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
                  >
                    {showApiKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </span>
              </div>
            </div>

            <details className="mt-5 border-t border-[var(--color-border)] pt-4">
              <summary className="cursor-pointer select-none text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">{t('provider.advanced')}</summary>
              <div className="mt-4">
                <TextField label={t('provider.baseUrl')} value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} />
                <p className="mt-2 text-xs text-[var(--color-text-subtle)]">{t('provider.protocol', { protocol: provider.protocol })}</p>
              </div>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReadyStep({ language, theme, provider, model }: { language: string; theme: string; provider?: string; model?: string }) {
  const { t } = useTranslation(['setup', 'common']);
  const rows = [
    { label: t('common:language.label'), value: language },
    { label: t('setup:preferences.appearance'), value: theme },
    { label: t('setup:ready.provider'), value: provider ?? t('setup:ready.notConfigured') },
    { label: t('setup:ready.defaultModel'), value: model ?? t('setup:ready.configureLater') },
  ];
  return (
    <div>
      <StepHeading
        eyebrow={t('setup:ready.eyebrow')}
        title={t('setup:ready.title')}
        description={t('setup:ready.description')}
      />
      <div className="max-w-2xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-accent-soft)] px-5 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-foreground)]">
            <Check size={19} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">{t('setup:ready.setupComplete')}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t('setup:ready.changeLater')}</p>
          </div>
        </div>
        <dl className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[9rem_1fr] gap-4 px-5 py-4 text-sm">
              <dt className="text-[var(--color-text-muted)]">{row.label}</dt>
              <dd className="font-medium text-[var(--color-text)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
