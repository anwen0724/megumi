import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import type { ProviderId, ProviderPublicStatus } from '@megumi/shared/provider';
import { useProviderStore } from '../../../entities/provider';
import { Badge, Button, IconButton, TextField } from '../../../shared/ui';
import { COMPOSER_MODEL_OPTIONS } from '../../chat/components/composer-options';

interface ProviderFormState {
  enabled: boolean;
  baseUrl: string;
  defaultModelId: string;
  apiKey: string;
}

function credentialLabel(provider: ProviderPublicStatus): string {
  if (provider.envOverrideActive) return 'Environment key';
  if (provider.hasApiKey) return 'Settings key';
  return 'Missing key';
}

function credentialVariant(provider: ProviderPublicStatus): 'success' | 'warning' | 'neutral' {
  if (provider.envOverrideActive || provider.hasApiKey) return 'success';
  if (provider.providerId === 'anthropic') return 'neutral';
  return 'warning';
}

function createInitialFormState(provider: ProviderPublicStatus): ProviderFormState {
  return {
    enabled: provider.enabled,
    baseUrl: provider.baseUrl ?? '',
    defaultModelId: String(provider.defaultModelId),
    apiKey: '',
  };
}

export function ProviderSettingsPanel() {
  const providers = useProviderStore((state) => state.providers);
  const status = useProviderStore((state) => state.status);
  const error = useProviderStore((state) => state.error);
  const loadProviders = useProviderStore((state) => state.loadProviders);
  const updateProvider = useProviderStore((state) => state.updateProvider);
  const setApiKey = useProviderStore((state) => state.setApiKey);
  const deleteApiKey = useProviderStore((state) => state.deleteApiKey);
  const [forms, setForms] = useState<Record<string, ProviderFormState>>({});

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    setForms((current) => {
      const next = { ...current };

      for (const provider of providers) {
        if (!next[provider.providerId]) {
          next[provider.providerId] = createInitialFormState(provider);
        }
      }

      return next;
    });
  }, [providers]);

  function updateForm(providerId: ProviderId, update: Partial<ProviderFormState>) {
    setForms((current) => ({
      ...current,
      [providerId]: {
        ...(current[providerId] ?? {
          enabled: true,
          baseUrl: '',
          defaultModelId: '',
          apiKey: '',
        }),
        ...update,
      },
    }));
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>, provider: ProviderPublicStatus) {
    event.preventDefault();
    const form = forms[provider.providerId] ?? createInitialFormState(provider);

    await updateProvider({
      providerId: provider.providerId,
      baseUrl: form.baseUrl.trim() || undefined,
      defaultModelId: form.defaultModelId,
    });
  }

  async function handleEnabledChange(provider: ProviderPublicStatus, enabled: boolean) {
    updateForm(provider.providerId, { enabled });

    await updateProvider({
      providerId: provider.providerId,
      enabled,
    });
  }

  async function handleApiKeySubmit(event: FormEvent<HTMLFormElement>, provider: ProviderPublicStatus) {
    event.preventDefault();
    const form = forms[provider.providerId];
    const apiKey = form?.apiKey.trim();

    if (!apiKey) return;

    await setApiKey({ providerId: provider.providerId, apiKey });
    updateForm(provider.providerId, { apiKey: '' });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Provider settings</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Configure model providers for the real chat runtime. API keys are sent only to the main process secret store.
          </p>
        </div>
        <IconButton label="Refresh providers" variant="ghost" size="sm" onClick={() => void loadProviders()}>
          <RefreshCw size={15} aria-hidden="true" />
        </IconButton>
      </div>

      {error ? (
        <p className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {status === 'loading' && providers.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading providers...</p>
      ) : null}

      <div className="space-y-3">
        {providers.map((provider) => {
          const form = forms[provider.providerId] ?? createInitialFormState(provider);
          const modelOptions = COMPOSER_MODEL_OPTIONS.filter((option) => option.providerId === provider.providerId);

          return (
            <section
              key={provider.providerId}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-[var(--color-text)]">{provider.displayName}</h4>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{provider.providerId}</p>
                </div>
                <Badge variant={credentialVariant(provider)}>{credentialLabel(provider)}</Badge>
              </div>

              <form className="space-y-3" onSubmit={(event) => void handleSettingsSubmit(event, provider)}>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => void handleEnabledChange(provider, event.target.checked)}
                    disabled={status === 'saving'}
                  />
                  Enabled
                </label>

                <TextField
                  label={`${provider.displayName} base URL`}
                  value={form.baseUrl}
                  onChange={(event) => updateForm(provider.providerId, { baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                />

                <label className="block text-xs font-medium text-[var(--color-text-muted)]">
                  {provider.displayName} default model
                  <select
                    aria-label={`${provider.displayName} default model`}
                    value={form.defaultModelId}
                    onChange={(event) => updateForm(provider.providerId, { defaultModelId: event.target.value })}
                    className="mt-1 h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-2 text-sm text-[var(--color-text)]"
                  >
                    {modelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <Button type="submit" size="sm" variant="secondary" disabled={status === 'saving'}>
                  Save {provider.displayName} settings
                </Button>
              </form>

              <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => void handleApiKeySubmit(event, provider)}>
                <div className="min-w-56 flex-1">
                  <TextField
                    label={`${provider.displayName} API key`}
                    type="password"
                    value={form.apiKey}
                    onChange={(event) => updateForm(provider.providerId, { apiKey: event.target.value })}
                    placeholder={provider.hasApiKey || provider.envOverrideActive ? 'Replace API key' : 'Paste API key'}
                  />
                </div>
                <Button type="submit" size="sm" variant="primary" disabled={status === 'saving' || !form.apiKey.trim()}>
                  <KeyRound size={14} aria-hidden="true" />
                  Save {provider.displayName} API key
                </Button>
                <IconButton
                  label={`Delete ${provider.displayName} API key`}
                  size="sm"
                  variant="secondary"
                  onClick={() => void deleteApiKey({ providerId: provider.providerId })}
                  disabled={status === 'saving' || provider.envOverrideActive}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </IconButton>
              </form>
            </section>
          );
        })}
      </div>
    </div>
  );
}

