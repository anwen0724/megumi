// Renders the blocking first-run setup wizard before the desktop shell enters the main product UI.
import { useState } from 'react';
import type { ProviderId } from '@megumi/shared/provider';
import type { AppLanguage } from '@megumi/coding-agent/host-interface';
import { Button, TextField, cx } from '../../shared/ui';
import { themeDefinitions, themeNames, useThemeStore, type ThemeName } from '../../shared/theme';
import { useSetupWizardStore } from './setup-wizard-store';

type Step = 'language' | 'theme' | 'provider' | 'api-key';

const steps: Step[] = ['language', 'theme', 'provider', 'api-key'];

const providerOptions: Array<{ id: ProviderId; label: string }> = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'custom', label: 'Third-party compatible' },
];

function nextStep(current: Step): Step {
  return steps[Math.min(steps.indexOf(current) + 1, steps.length - 1)];
}

function previousStep(current: Step): Step {
  return steps[Math.max(steps.indexOf(current) - 1, 0)];
}

export function SetupWizard() {
  const status = useSetupWizardStore((state) => state.status);
  const error = useSetupWizardStore((state) => state.error);
  const completeSetup = useSetupWizardStore((state) => state.completeSetup);
  const applyTheme = useThemeStore((state) => state.setTheme);
  const [step, setStep] = useState<Step>('language');
  const [language, setLanguage] = useState<AppLanguage>('zh-CN');
  const [theme, setTheme] = useState<ThemeName>('midnight-blue');
  const [providerId, setProviderId] = useState<ProviderId | ''>('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelIdsText, setModelIdsText] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [skipProvider, setSkipProvider] = useState(false);

  const saving = status === 'saving';
  const selectedProviderId = skipProvider ? 'deepseek' : providerId;
  const providerStepComplete = skipProvider || Boolean(providerId);
  const finishDisabled = saving || (
    !skipProvider && (!providerId || parseModelIds(modelIdsText).length === 0 || (providerId !== 'anthropic' && !baseUrl.trim()))
  );

  function handleThemeChange(nextTheme: ThemeName) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  async function handleFinish() {
    if (!selectedProviderId) {
      return;
    }

    await completeSetup({
      language,
      theme,
      providerId: selectedProviderId,
      baseUrl,
      modelIds: parseModelIds(modelIdsText),
      apiKey,
      skipProvider,
    });
    setApiKey('');
  }

  return (
    <main
      data-testid="setup-wizard"
      className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 py-8"
    >
      <section className="w-full max-w-xl">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            First-run setup
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text)]">Set up Megumi</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            Configure the basics stored in your local user settings before opening the workspace.
          </p>
        </div>

        <div className="mb-5 flex gap-2" aria-label="Setup progress">
          {steps.map((item) => (
            <span
              key={item}
              className={cx(
                'h-1.5 flex-1 rounded-full',
                steps.indexOf(item) <= steps.indexOf(step)
                  ? 'bg-[var(--color-accent)]'
                  : 'bg-[var(--color-border)]',
              )}
            />
          ))}
        </div>

        <div className="min-h-72 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          {step === 'language' ? (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Language</h2>
              <label className="block text-xs font-medium text-[var(--color-text-muted)]">
                Language
                <select
                  className="mt-1 h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-2 text-sm text-[var(--color-text)]"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as AppLanguage)}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
              <p className="text-xs leading-5 text-[var(--color-text-muted)]">
                This release stores the language preference for future localization. The full UI remains in the current project copy.
              </p>
            </div>
          ) : null}

          {step === 'theme' ? (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Theme</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {themeNames.map((themeName) => (
                  <label
                    key={themeName}
                    className={cx(
                      'flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm',
                      theme === themeName
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-elevated)]',
                    )}
                  >
                    <input
                      type="radio"
                      name="theme"
                      checked={theme === themeName}
                      onChange={() => handleThemeChange(themeName)}
                    />
                    {themeDefinitions[themeName].label}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {step === 'provider' ? (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Provider</h2>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={skipProvider}
                  onChange={(event) => setSkipProvider(event.target.checked)}
                />
                Configure provider later
              </label>
              <label className="block text-xs font-medium text-[var(--color-text-muted)]">
                Provider
                <select
                  className="mt-1 h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-2 text-sm text-[var(--color-text)]"
                  value={providerId}
                  disabled={skipProvider}
                  onChange={(event) => setProviderId(event.target.value as ProviderId)}
                >
                  <option value="">Select provider</option>
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
              </label>
              <TextField
                label="Base URL"
                value={baseUrl}
                disabled={skipProvider}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <TextField
                label="Model IDs"
                value={modelIdsText}
                disabled={skipProvider}
                onChange={(event) => setModelIdsText(event.target.value)}
                placeholder="model-id, another-model-id"
              />
            </div>
          ) : null}

          {step === 'api-key' ? (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">API key</h2>
              {skipProvider ? (
                <p className="rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-text)]">
                  Provider configuration will be skipped. You can configure it later in Settings.
                </p>
              ) : (
                <TextField
                  label="API key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Paste API key"
                />
              )}
              <p className="text-xs leading-5 text-[var(--color-text-muted)]">
                API keys entered here follow the current settings design and are written to the local settings file.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={step === 'language' || saving}
            onClick={() => setStep(previousStep(step))}
          >
            Back
          </Button>
          {step === 'api-key' ? (
            <Button variant="primary" disabled={finishDisabled} onClick={() => void handleFinish()}>
              Finish setup
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={saving || (step === 'provider' && !providerStepComplete)}
              onClick={() => setStep(nextStep(step))}
            >
              Next
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}

function parseModelIds(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

