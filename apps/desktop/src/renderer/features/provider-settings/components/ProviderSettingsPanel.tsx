import { FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronDown,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Trash2,
} from 'lucide-react';
import type { ProviderPublicStatusUiDto } from '@megumi/coding-agent/host-interface';
import { useProviderStore } from '../../../entities/provider';
import { Badge, Button, IconButton, cx } from '../../../shared/ui';

type ProviderProtocol = 'openai-compatible' | 'anthropic';

interface ProviderFormState {
  provider: string;
  protocol: ProviderProtocol;
  enabled: boolean;
  baseUrl: string;
  modelIdsText: string;
  apiKey: string;
}

type ProviderListEntry =
  | { source: 'quick'; providerId: string; displayName: string; protocol: ProviderProtocol; provider?: undefined }
  | { source: 'saved'; providerId: string; displayName: string; protocol: ProviderProtocol; provider: ProviderPublicStatusUiDto }
  | { source: 'draft'; providerId: string; displayName: string; protocol: ProviderProtocol; provider?: undefined };

const newProviderId = '__new_provider__';
const deepSeekProviderId = 'DeepSeek';

const quickProviders: Array<{ providerId: string; displayName: string; protocol: ProviderProtocol }> = [
  {
    providerId: deepSeekProviderId,
    displayName: 'DeepSeek',
    protocol: 'openai-compatible',
  },
];

function credentialLabel(provider: ProviderPublicStatusUiDto): string {
  if (provider.credentialSource === 'settings') return 'Settings key active';
  if (provider.credentialSource === 'environment') return 'Environment key active';
  return 'Missing key';
}

function createInitialFormState(provider: ProviderPublicStatusUiDto): ProviderFormState {
  return {
    provider: provider.providerId,
    protocol: provider.protocol,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl ?? '',
    modelIdsText: provider.modelIds.join('\n'),
    apiKey: '',
  };
}

function createQuickProviderFormState(entry: { providerId: string; protocol: ProviderProtocol }): ProviderFormState {
  return {
    provider: entry.providerId,
    protocol: entry.protocol,
    enabled: true,
    baseUrl: '',
    modelIdsText: '',
    apiKey: '',
  };
}

function createNewProviderFormState(): ProviderFormState {
  return {
    provider: '',
    protocol: 'openai-compatible',
    enabled: true,
    baseUrl: '',
    modelIdsText: '',
    apiKey: '',
  };
}

function parseModelIds(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function providerIconClassName(index: number, selected: boolean): string {
  const accents = [
    'bg-blue-500/15 text-blue-300 ring-blue-400/30',
    'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
    'bg-slate-500/20 text-slate-300 ring-slate-400/20',
  ];
  return cx(
    'grid h-8 w-8 shrink-0 place-items-center rounded-md ring-1',
    selected ? 'bg-blue-500/20 text-blue-200 ring-blue-300/40' : accents[index % accents.length],
  );
}

export function ProviderSettingsPanel() {
  const providers = useProviderStore((state) => state.providers);
  const status = useProviderStore((state) => state.status);
  const error = useProviderStore((state) => state.error);
  const loadProviders = useProviderStore((state) => state.loadProviders);
  const updateProvider = useProviderStore((state) => state.updateProvider);
  const deleteProvider = useProviderStore((state) => state.deleteProvider);
  const setApiKey = useProviderStore((state) => state.setApiKey);
  const [query, setQuery] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(deepSeekProviderId);
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

  const entries = useMemo<ProviderListEntry[]>(() => {
    const usedProviderIds = new Set<string>();
    const quickEntries = quickProviders.map((quick): ProviderListEntry => {
      const saved = providers.find((provider) => provider.providerId === quick.providerId);
      if (saved) {
        usedProviderIds.add(saved.providerId);
        return {
          source: 'saved',
          providerId: saved.providerId,
          displayName: saved.displayName,
          protocol: saved.protocol,
          provider: saved,
        };
      }
      return {
        source: 'quick',
        providerId: quick.providerId,
        displayName: quick.displayName,
        protocol: quick.protocol,
      };
    });

    const savedEntries = providers
      .filter((provider) => !usedProviderIds.has(provider.providerId))
      .map((provider): ProviderListEntry => ({
        source: 'saved',
        providerId: provider.providerId,
        displayName: provider.displayName,
        protocol: provider.protocol,
        provider,
      }));

    return [...quickEntries, ...savedEntries];
  }, [providers]);

  useEffect(() => {
    if (selectedProviderId === newProviderId) return;
    if (selectedProviderId && entries.some((entry) => entry.providerId === selectedProviderId)) return;
    setSelectedProviderId(entries[0]?.providerId ?? deepSeekProviderId);
  }, [entries, selectedProviderId]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return entries;
    return entries.filter((entry) => (
      entry.displayName.toLowerCase().includes(normalizedQuery)
      || entry.providerId.toLowerCase().includes(normalizedQuery)
    ));
  }, [entries, query]);

  const selectedEntry = selectedProviderId === newProviderId
    ? undefined
    : entries.find((entry) => entry.providerId === selectedProviderId);
  const selectedProvider = selectedEntry?.source === 'saved' ? selectedEntry.provider : undefined;
  const selectedFormKey = selectedProviderId ?? deepSeekProviderId;
  const selectedForm = forms[selectedFormKey] ?? (
    selectedProvider
      ? createInitialFormState(selectedProvider)
      : selectedEntry
        ? createQuickProviderFormState(selectedEntry)
        : createNewProviderFormState()
  );
  const isCreating = selectedProviderId === newProviderId;
  const isSaving = status === 'saving';

  function startAddProvider() {
    setForms((current) => ({
      ...current,
      [newProviderId]: current[newProviderId] ?? createNewProviderFormState(),
    }));
    setSelectedProviderId(newProviderId);
  }

  function updateForm(update: Partial<ProviderFormState>) {
    setForms((current) => ({
      ...current,
      [selectedFormKey]: {
        ...(current[selectedFormKey] ?? selectedForm),
        ...update,
      },
    }));
  }

  function selectEntry(entry: ProviderListEntry) {
    setSelectedProviderId(entry.providerId);
    setForms((current) => ({
      ...current,
      [entry.providerId]: current[entry.providerId] ?? (
        entry.source === 'saved'
          ? createInitialFormState(entry.provider)
          : createQuickProviderFormState(entry)
      ),
    }));
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const providerName = selectedForm.provider.trim();
    const modelIds = parseModelIds(selectedForm.modelIdsText);

    if (!providerName || modelIds.length === 0) return;

    await updateProvider({
      providerId: providerName,
      displayName: providerName,
      enabled: selectedForm.enabled,
      protocol: selectedForm.protocol,
      baseUrl: selectedForm.baseUrl.trim() || undefined,
      modelIds,
    });

    if (selectedForm.apiKey.trim()) {
      await setApiKey({ providerId: providerName, apiKey: selectedForm.apiKey.trim() });
      setForms((current) => ({
        ...current,
        [selectedFormKey]: {
          ...(current[selectedFormKey] ?? selectedForm),
          apiKey: '',
        },
      }));
    }

    if (isCreating || selectedEntry?.source === 'quick') {
      setSelectedProviderId(providerName);
      setForms((current) => {
        const next = { ...current };
        delete next[newProviderId];
        return next;
      });
    }
  }

  async function handleDeleteProvider() {
    if (!selectedProvider || isSaving) return;
    await deleteProvider({ providerId: selectedProvider.providerId });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-normal text-[var(--color-text)]">Models</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Configure custom model providers and model IDs.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-[28rem] grid-cols-[minmax(17rem,0.9fr)_minmax(26rem,1.55fr)] gap-3">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-[var(--color-text)]">Providers</h3>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={startAddProvider}
              disabled={isSaving}
              className="border-blue-400/25 bg-blue-500/10 text-blue-200 hover:bg-blue-500/15"
            >
              <Plus size={15} aria-hidden="true" />
              Add provider
            </Button>
          </div>

          <label className="mt-4 flex h-10 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-app-bg)]/60 px-3 text-sm text-[var(--color-text-muted)]">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search providers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search providers..."
              className="min-w-0 flex-1 bg-transparent text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
            />
            <span className="text-xs text-[var(--color-text-subtle)]">⌘ K</span>
          </label>

          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-300/80">API</p>
            <div className="space-y-2">
              {isCreating ? (
                <ProviderListItem
                  entry={{
                    source: 'draft',
                    providerId: newProviderId,
                    displayName: selectedForm.provider || 'New provider',
                    protocol: selectedForm.protocol,
                  }}
                  modelCount={parseModelIds(selectedForm.modelIdsText).length}
                  index={0}
                  selected
                  onClick={() => setSelectedProviderId(newProviderId)}
                />
              ) : null}

              {filteredEntries.map((entry, index) => (
                <ProviderListItem
                  key={`${entry.source}:${entry.providerId}`}
                  entry={entry}
                  modelCount={entry.source === 'saved' ? entry.provider.modelIds.length : 0}
                  index={index}
                  selected={selectedProviderId === entry.providerId}
                  onClick={() => selectEntry(entry)}
                />
              ))}

              {status === 'loading' && providers.length === 0 ? (
                <p className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">
                  Loading providers...
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          {selectedEntry || isCreating ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={providerIconClassName(0, true)}>
                    <Bot size={19} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-semibold text-[var(--color-text)]">
                        {selectedForm.provider || 'New provider'}
                      </h3>
                      <Badge variant={selectedForm.enabled ? 'success' : 'neutral'}>
                        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
                        {selectedForm.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    {selectedProvider ? (
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{credentialLabel(selectedProvider)}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <IconButton
                    label="Refresh providers"
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadProviders()}
                    disabled={isSaving}
                  >
                    <RefreshCw size={15} aria-hidden="true" />
                  </IconButton>
                  <Button
                    type="submit"
                    form="provider-settings-form"
                    size="sm"
                    variant="primary"
                    disabled={isSaving}
                    className="border-blue-400/40 bg-blue-500/20 text-blue-100 hover:bg-blue-500/25"
                  >
                    <Save size={15} aria-hidden="true" />
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleDeleteProvider()}
                    disabled={!selectedProvider || isSaving}
                    className="border-red-400/35 bg-red-500/10 text-red-300 hover:bg-red-500/15"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>

              <form id="provider-settings-form" className="mt-5 space-y-3" onSubmit={(event) => void handleSettingsSubmit(event)}>
                <FieldRow label="Provider">
                  <input
                    aria-label="Provider"
                    value={selectedForm.provider}
                    onChange={(event) => updateForm({ provider: event.target.value })}
                    className={fieldClassName}
                    placeholder="Enter provider name"
                    disabled={selectedEntry?.source === 'quick' || selectedEntry?.source === 'saved'}
                  />
                </FieldRow>

                <FieldRow label="Protocol">
                  <div className="relative">
                    <select
                      aria-label="Protocol"
                      value={selectedForm.protocol}
                      onChange={(event) => updateForm({ protocol: event.target.value as ProviderProtocol })}
                      className={cx(fieldClassName, 'appearance-none pr-10')}
                    >
                      <option value="openai-compatible">OpenAI Compatible</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                    />
                  </div>
                </FieldRow>

                <FieldRow label="Base URL">
                  <input
                    aria-label="Base URL"
                    value={selectedForm.baseUrl}
                    onChange={(event) => updateForm({ baseUrl: event.target.value })}
                    className={fieldClassName}
                    placeholder="Enter provider API base URL"
                  />
                </FieldRow>

                <FieldRow label="API Key">
                  <input
                    aria-label="API Key"
                    type="password"
                    value={selectedForm.apiKey}
                    onChange={(event) => updateForm({ apiKey: event.target.value })}
                    className={fieldClassName}
                    placeholder={selectedProvider?.hasApiKey || selectedProvider?.envOverrideActive ? 'API key already saved' : 'Paste API key'}
                  />
                </FieldRow>

                <FieldRow label="Models" alignTop>
                  <textarea
                    aria-label="Models"
                    value={selectedForm.modelIdsText}
                    onChange={(event) => updateForm({ modelIdsText: event.target.value })}
                    className={cx(fieldClassName, 'min-h-28 resize-y py-2 leading-6')}
                    placeholder="Enter one model per line"
                  />
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    Models configured here appear in the chat composer model picker.
                  </p>
                </FieldRow>
              </form>
            </>
          ) : (
            <div className="grid h-full min-h-[22rem] place-items-center text-center">
              <div>
                <Server size={24} aria-hidden="true" className="mx-auto text-[var(--color-text-subtle)]" />
                <p className="mt-3 text-sm font-medium text-[var(--color-text)]">Select or add a provider</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Provider settings control which models appear in chat.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const fieldClassName = 'h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-app-bg)]/65 px-3 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20 disabled:cursor-not-allowed disabled:opacity-60';

function ProviderListItem({
  entry,
  modelCount,
  index,
  selected,
  onClick,
}: {
  entry: ProviderListEntry;
  modelCount: number;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const enabled = entry.source !== 'saved' || entry.provider.enabled;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
        selected
          ? 'bg-[var(--color-surface-elevated)] text-[var(--color-text)] shadow-sm'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-elevated)]/70 hover:text-[var(--color-text)]',
      )}
    >
      {selected ? <span className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-blue-400" /> : null}
      <span className={providerIconClassName(index, selected)}>
        <Bot size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{entry.displayName}</span>
        {!enabled ? <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">Disabled</span> : null}
      </span>
      <span className="rounded-md bg-blue-500/15 px-2 py-1 text-xs font-medium text-blue-300">
        {modelCount} {modelCount === 1 ? 'model' : 'models'}
      </span>
    </button>
  );
}

function FieldRow({
  label,
  alignTop = false,
  children,
}: {
  label: string;
  alignTop?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx('grid grid-cols-[8rem_minmax(0,1fr)] gap-4', alignTop ? 'items-start' : 'items-center')}>
      <span className="pt-0.5 text-sm font-medium text-[var(--color-text-muted)]">{label}</span>
      <span>{children}</span>
    </div>
  );
}
