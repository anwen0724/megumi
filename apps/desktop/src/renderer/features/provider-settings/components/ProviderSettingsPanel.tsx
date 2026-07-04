import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import type { ProviderId, ProviderPublicStatus } from '@megumi/shared/provider';
import { useProviderStore } from '../../../entities/provider';
import { Badge, Button, IconButton, TextField } from '../../../shared/ui';
import { COMPOSER_MODEL_OPTIONS } from '../../chat/components/composer-options';

interface ProviderFormState {
  enabled: boolean;
  baseUrl: string;
  modelIdsText: string;
  apiKey: string;
  apiKeyEnv: string;
}

function credentialLabel(provider: ProviderPublicStatus): string {
  if (provider.credentialSource === 'settings') return 'Settings key active';
  if (provider.credentialSource === 'environment') return 'Environment key active';
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
    modelIdsText: provider.modelIds.join(', '),
    apiKey: '',
    apiKeyEnv: provider.apiKeyEnvCustomized ? provider.apiKeyEnv ?? '' : '',
  };
}

function parseModelIds(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function appendModelId(value: string, modelId: string): string {
  return Array.from(new Set([...parseModelIds(value), modelId])).join(', ');
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
          modelIdsText: '',
          apiKey: '',
          apiKeyEnv: '',
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
      modelIds: parseModelIds(form.modelIdsText),
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

  async function handleApiKeyEnvSubmit(event: FormEvent<HTMLFormElement>, provider: ProviderPublicStatus) {
    event.preventDefault();
    const form = forms[provider.providerId] ?? createInitialFormState(provider);
    const apiKeyEnv = form.apiKeyEnv.trim();

    if (!apiKeyEnv) return;

    await updateProvider({
      providerId: provider.providerId,
      apiKeyEnv,
    });
  }

  async function handleApiKeyEnvClear(provider: ProviderPublicStatus) {
    updateForm(provider.providerId, { apiKeyEnv: '' });

    await updateProvider({
      providerId: provider.providerId,
      apiKeyEnv: null,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Provider settings</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Configure model providers for the real chat runtime. API keys are stored in settings or read from configured environment variables.
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

                <TextField
                  label={`${provider.displayName} model IDs`}
                  value={form.modelIdsText}
                  onChange={(event) => updateForm(provider.providerId, { modelIdsText: event.target.value })}
                  placeholder="model-id, another-model-id"
                />

                <label className="block text-xs font-medium text-[var(--color-text-muted)]">
                  {provider.displayName} known model
                  <select
                    aria-label={`${provider.displayName} known model`}
                    value=""
                    onChange={(event) => {
                      if (event.target.value) {
                        updateForm(provider.providerId, {
                          modelIdsText: appendModelId(form.modelIdsText, event.target.value),
                        });
                      }
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-2 text-sm text-[var(--color-text)]"
                  >
                    <option value="">Add known model</option>
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
                  disabled={status === 'saving' || provider.credentialSource !== 'settings'}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </IconButton>
              </form>

              <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => void handleApiKeyEnvSubmit(event, provider)}>
                <div className="min-w-56 flex-1">
                  <TextField
                    label={`${provider.displayName} API key environment variable`}
                    value={form.apiKeyEnv}
                    onChange={(event) => updateForm(provider.providerId, { apiKeyEnv: event.target.value })}
                    placeholder={provider.apiKeyEnv ? `Default: ${provider.apiKeyEnv}` : 'PROVIDER_API_KEY'}
                  />
                </div>
                <Button type="submit" size="sm" variant="secondary" disabled={status === 'saving' || !form.apiKeyEnv.trim()}>
                  Save {provider.displayName} environment variable
                </Button>
                <IconButton
                  label={`Clear ${provider.displayName} environment variable`}
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleApiKeyEnvClear(provider)}
                  disabled={status === 'saving' || !provider.apiKeyEnvCustomized}
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

