/*
 * Renders provider connection settings and focused per-model configuration.
 * Provider discovery stays in the left pane; model details are edited in a dialog.
 */
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  ChevronDown,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ModelSupportLevelUi,
  ProviderCatalogUiDto,
  ProviderPublicStatusUiDto,
} from '@megumi/product/host-interface';
import { useProviderStore } from '../../../entities/provider';
import {
  Badge,
  Button,
  IconButton,
  SettingsPageHeader,
  cx,
} from '../../../shared/ui';
import { formatNumber, formatTokenCount, localizeRendererError } from '../../../shared/i18n';

type ProviderProtocol = 'openai-compatible' | 'anthropic';

interface ProviderModelForm {
  modelId: string;
  displayName: string;
  contextWindowTokens: string;
  imageInput: ModelSupportLevelUi;
  imageInputOverride?: ModelSupportLevelUi;
}

interface ProviderFormState {
  provider: string;
  protocol: ProviderProtocol;
  enabled: boolean;
  baseUrl: string;
  models: ProviderModelForm[];
  apiKey: string;
  apiKeyDirty: boolean;
}

interface ModelEditorState {
  originalModelId?: string;
  model: ProviderModelForm;
}

type ProviderListEntry =
  | { source: 'quick'; providerId: string; displayName: string; protocol: ProviderProtocol; catalog: ProviderCatalogUiDto; provider?: undefined }
  | { source: 'saved'; providerId: string; displayName: string; protocol: ProviderProtocol; provider: ProviderPublicStatusUiDto }
  | { source: 'draft'; providerId: string; displayName: string; protocol: ProviderProtocol; provider?: undefined };

const newProviderId = '__new_provider__';
const contextWindowPresets = [
  { label: '64K', value: 65_536 },
  { label: '128K', value: 131_072 },
  { label: '200K', value: 200_000 },
  { label: '256K', value: 262_144 },
  { label: '1M', value: 1_048_576 },
];

function createInitialFormState(
  provider: ProviderPublicStatusUiDto,
  catalogEntry?: ProviderCatalogUiDto,
): ProviderFormState {
  return {
    provider: provider.providerId,
    protocol: provider.protocol,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl ?? '',
    models: provider.modelIds.map((modelId) => {
      const model = provider.modelSettings?.[modelId];
      const catalogModel = catalogEntry?.models.find((candidate) => candidate.modelId === modelId);
      const imageInput = model?.capabilities.imageInput
        ?? provider.modelCapabilities?.[modelId]?.imageInput
        ?? catalogModel?.capabilities.imageInput
        ?? 'unknown';
      const imageInputOverride = model?.capabilityOverrides.imageInput
        ?? provider.modelCapabilityOverrides?.[modelId]?.imageInput;
      return {
        modelId,
        displayName: model?.displayName ?? catalogModel?.displayName ?? modelId,
        contextWindowTokens: String(model?.contextWindowTokens ?? catalogModel?.contextWindowTokens ?? 262_144),
        imageInput,
        ...(imageInputOverride !== undefined ? { imageInputOverride } : {}),
      };
    }),
    apiKey: provider.apiKey ?? '',
    apiKeyDirty: false,
  };
}

function createQuickProviderFormState(entry: ProviderCatalogUiDto): ProviderFormState {
  return {
    provider: entry.providerId,
    protocol: entry.protocol,
    enabled: true,
    baseUrl: entry.defaultBaseUrl,
    models: entry.models.map((model) => ({
      modelId: model.modelId,
      displayName: model.displayName,
      contextWindowTokens: String(model.contextWindowTokens),
      imageInput: model.capabilities.imageInput,
    })),
    apiKey: '',
    apiKeyDirty: false,
  };
}

function createNewProviderFormState(): ProviderFormState {
  return {
    provider: '',
    protocol: 'openai-compatible',
    enabled: true,
    baseUrl: '',
    models: [],
    apiKey: '',
    apiKeyDirty: false,
  };
}

function providerIconClassName(selected: boolean): string {
  return cx(
    'grid h-8 w-8 shrink-0 place-items-center rounded-md ring-1',
    selected
      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] ring-[var(--color-accent)]/35'
      : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] ring-[var(--color-border)]',
  );
}

function formatContextWindow(value: string): string {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens <= 0) return value;
  return formatTokenCount(tokens);
}

export function ProviderSettingsPanel() {
  const { t } = useTranslation('settings');
  const providers = useProviderStore((state) => state.providers);
  const catalog = useProviderStore((state) => state.catalog);
  const status = useProviderStore((state) => state.status);
  const error = useProviderStore((state) => state.error);
  const loadProviders = useProviderStore((state) => state.loadProviders);
  const updateProvider = useProviderStore((state) => state.updateProvider);
  const deleteProvider = useProviderStore((state) => state.deleteProvider);
  const setApiKey = useProviderStore((state) => state.setApiKey);
  const [query, setQuery] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, ProviderFormState>>({});
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelEditor, setModelEditor] = useState<ModelEditorState | null>(null);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    setForms((current) => {
      const next = { ...current };
      for (const provider of providers) {
        if (!next[provider.providerId]) {
          const catalogEntry = catalog.find(
            (candidate) => candidate.providerId.toLowerCase() === provider.providerId.toLowerCase(),
          );
          next[provider.providerId] = createInitialFormState(provider, catalogEntry);
        }
      }
      return next;
    });
  }, [catalog, providers]);

  const entries = useMemo<ProviderListEntry[]>(() => {
    const usedProviderIds = new Set<string>();
    const quickEntries = catalog.map((quick): ProviderListEntry => {
      const saved = providers.find(
        (provider) => provider.providerId.toLowerCase() === quick.providerId.toLowerCase(),
      );
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
        catalog: quick,
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
  }, [catalog, providers]);

  useEffect(() => {
    if (selectedProviderId === newProviderId) return;
    if (selectedProviderId && entries.some((entry) => entry.providerId === selectedProviderId)) return;
    setSelectedProviderId(entries[0]?.providerId ?? null);
  }, [entries, selectedProviderId]);

  useEffect(() => {
    setShowApiKey(false);
    setModelEditor(null);
  }, [selectedProviderId]);

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
  const selectedFormKey = selectedProviderId ?? newProviderId;
  const selectedCatalogEntry = selectedEntry?.source === 'quick'
    ? selectedEntry.catalog
    : catalog.find((entry) => entry.providerId.toLowerCase() === selectedFormKey.toLowerCase());
  const selectedForm = forms[selectedFormKey] ?? (
    selectedProvider
      ? createInitialFormState(selectedProvider, selectedCatalogEntry)
      : selectedEntry?.source === 'quick'
        ? createQuickProviderFormState(selectedEntry.catalog)
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
          ? createInitialFormState(
              entry.provider,
              catalog.find((candidate) => candidate.providerId.toLowerCase() === entry.providerId.toLowerCase()),
            )
          : entry.source === 'quick'
            ? createQuickProviderFormState(entry.catalog)
            : createNewProviderFormState()
      ),
    }));
  }

  function openModelEditor(model: ProviderModelForm) {
    setModelEditor({ originalModelId: model.modelId, model: { ...model } });
  }

  function startAddModel() {
    setModelEditor({
      model: {
        modelId: '',
        displayName: '',
        contextWindowTokens: '262144',
        imageInput: 'unknown',
      },
    });
  }

  function saveModelEditor() {
    if (!modelEditor) return;
    const modelId = modelEditor.model.modelId.trim();
    const contextWindowTokens = Number(modelEditor.model.contextWindowTokens);
    if (!modelId || !Number.isInteger(contextWindowTokens) || contextWindowTokens <= 0) return;
    if (!modelEditor.originalModelId && selectedForm.models.some((model) => model.modelId === modelId)) return;

    const nextModel: ProviderModelForm = {
      ...modelEditor.model,
      modelId,
      displayName: modelEditor.model.displayName.trim() || modelId,
      contextWindowTokens: String(contextWindowTokens),
    };
    updateForm({
      models: modelEditor.originalModelId
        ? selectedForm.models.map((model) => model.modelId === modelEditor.originalModelId ? nextModel : model)
        : [...selectedForm.models, nextModel],
    });
    setModelEditor(null);
  }

  function removeModel(modelId: string) {
    updateForm({ models: selectedForm.models.filter((model) => model.modelId !== modelId) });
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const providerName = selectedForm.provider.trim();
    if (!providerName || selectedForm.models.length === 0) return;

    await updateProvider({
      providerId: providerName,
      displayName: selectedEntry?.displayName ?? providerName,
      enabled: selectedForm.enabled,
      protocol: selectedForm.protocol,
      baseUrl: selectedForm.baseUrl.trim() || undefined,
      models: selectedForm.models.map((model) => ({
        modelId: model.modelId,
        displayName: model.displayName,
        contextWindowTokens: Number(model.contextWindowTokens),
        ...(model.imageInputOverride !== undefined ? { imageInput: model.imageInputOverride } : {}),
      })),
    });

    if (selectedForm.apiKeyDirty && selectedForm.apiKey.trim()) {
      await setApiKey({ providerId: providerName, apiKey: selectedForm.apiKey.trim() });
      updateForm({ apiKey: selectedForm.apiKey.trim(), apiKeyDirty: false });
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
      <SettingsPageHeader
        title={t('provider.title')}
        description={t('provider.description')}
      />

      {error ? (
        <p className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {localizeRendererError(error)}
        </p>
      ) : null}

      <div className="grid min-h-[28rem] gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(24rem,1.55fr)]">
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[var(--color-text)]">{t('provider.providers')}</h2>
            <Button type="button" size="sm" variant="secondary" onClick={startAddProvider} disabled={isSaving}>
              <Plus size={15} aria-hidden="true" />
              {t('provider.add')}
            </Button>
          </div>

          <label className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 text-sm text-[var(--color-text-muted)] focus-within:border-[var(--color-focus)] focus-within:ring-2 focus-within:ring-[var(--color-focus)]/20">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label={t('provider.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('provider.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
            />
          </label>

          <div className="mt-4 space-y-2">
            {isCreating ? (
              <ProviderListItem
                entry={{ source: 'draft', providerId: newProviderId, displayName: selectedForm.provider || t('provider.newProvider'), protocol: selectedForm.protocol }}
                modelCount={selectedForm.models.length}
                selected
                onClick={() => setSelectedProviderId(newProviderId)}
              />
            ) : null}

            {filteredEntries.map((entry) => (
              <ProviderListItem
                key={`${entry.source}:${entry.providerId}`}
                entry={entry}
                modelCount={entry.source === 'saved' ? entry.provider.modelIds.length : entry.source === 'quick' ? entry.catalog.models.length : 0}
                selected={selectedProviderId === entry.providerId}
                onClick={() => selectEntry(entry)}
              />
            ))}

            {status === 'loading' && providers.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">
                {t('provider.loading')}
              </p>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          {selectedEntry || isCreating ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={providerIconClassName(true)}><Bot size={19} aria-hidden="true" /></div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-[var(--color-text)]">{selectedForm.provider || t('provider.newProvider')}</h2>
                    <Badge variant={selectedForm.enabled ? 'success' : 'neutral'}>
                      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
                      {selectedForm.enabled ? t('provider.enabled') : t('provider.disabled')}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <IconButton label={t('provider.refresh')} variant="secondary" size="sm" onClick={() => void loadProviders()} disabled={isSaving}>
                    <RefreshCw size={15} aria-hidden="true" />
                  </IconButton>
                  <Button type="submit" form="provider-settings-form" size="sm" variant="primary" disabled={isSaving}>
                    <Save size={15} aria-hidden="true" /> {t('provider.save')}
                  </Button>
                  <Button type="button" size="sm" variant="danger" onClick={() => void handleDeleteProvider()} disabled={!selectedProvider || isSaving}>
                    <Trash2 size={15} aria-hidden="true" /> {t('provider.delete')}
                  </Button>
                </div>
              </div>

              <form id="provider-settings-form" className="mt-5 overflow-hidden rounded-lg border border-[var(--color-border)]" onSubmit={(event) => void handleSettingsSubmit(event)}>
                <FormGroup title={t('provider.connection')}>
                  <FieldRow label={t('provider.provider')}>
                    <input aria-label={t('provider.provider')} value={selectedForm.provider} onChange={(event) => updateForm({ provider: event.target.value })} className={fieldClassName} placeholder={t('provider.providerPlaceholder')} disabled={selectedEntry?.source === 'quick' || selectedEntry?.source === 'saved'} />
                  </FieldRow>
                  <FieldRow label={t('provider.protocol')}>
                    <div className="relative">
                      <select aria-label={t('provider.protocol')} value={selectedForm.protocol} onChange={(event) => updateForm({ protocol: event.target.value as ProviderProtocol })} className={cx(fieldClassName, 'appearance-none pr-10')}>
                        <option value="openai-compatible">OpenAI Compatible</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    </div>
                  </FieldRow>
                  <FieldRow label={t('provider.baseUrl')}>
                    <input aria-label={t('provider.baseUrl')} value={selectedForm.baseUrl} onChange={(event) => updateForm({ baseUrl: event.target.value })} className={fieldClassName} placeholder={t('provider.baseUrlPlaceholder')} />
                  </FieldRow>
                </FormGroup>

                <FormGroup title={t('provider.authentication')} bordered>
                  <FieldRow label={t('provider.apiKey')}>
                    <div className="relative">
                      <input
                        aria-label={t('provider.apiKey')}
                        type={showApiKey ? 'text' : 'password'}
                        value={selectedForm.apiKey}
                        onChange={(event) => updateForm({ apiKey: event.target.value, apiKeyDirty: true })}
                        className={cx(fieldClassName, 'pr-11')}
                        placeholder={t('provider.apiKeyPlaceholder')}
                      />
                      <button
                        type="button"
                        aria-label={showApiKey ? t('provider.hideApiKey') : t('provider.showApiKey')}
                        onClick={() => setShowApiKey((visible) => !visible)}
                        className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]"
                      >
                        {showApiKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                      </button>
                    </div>
                  </FieldRow>
                </FormGroup>

                <FormGroup title={t('provider.models')} bordered>
                  <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-app-bg)]/35">
                    {selectedForm.models.map((model, index) => (
                      <div key={model.modelId} className={cx('flex items-center gap-3 px-3 py-2.5', index > 0 ? 'border-t border-[var(--color-border)]' : undefined)}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[var(--color-text)]">{model.displayName}</p>
                        </div>
                        <span className="rounded bg-[var(--color-surface-muted)] px-2 py-1 text-xs text-[var(--color-text-muted)]">{formatContextWindow(model.contextWindowTokens)}</span>
                        <IconButton label={t('provider.editNamedModel', { name: model.displayName })} variant="secondary" size="sm" onClick={() => openModelEditor(model)}>
                          <Pencil size={14} aria-hidden="true" />
                        </IconButton>
                        <IconButton label={t('provider.removeNamedModel', { name: model.displayName })} variant="secondary" size="sm" onClick={() => removeModel(model.modelId)}>
                          <X size={14} aria-hidden="true" />
                        </IconButton>
                      </div>
                    ))}
                    {selectedForm.models.length === 0 ? (
                      <p className="px-3 py-5 text-center text-sm text-[var(--color-text-muted)]">{t('provider.noModels')}</p>
                    ) : null}
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={startAddModel}>
                    <Plus size={14} aria-hidden="true" /> {t('provider.addModel')}
                  </Button>
                </FormGroup>
              </form>
            </>
          ) : (
            <div className="grid h-full min-h-[22rem] place-items-center text-center">
              <div>
                <Server size={24} aria-hidden="true" className="mx-auto text-[var(--color-text-subtle)]" />
                <p className="mt-3 text-sm font-medium text-[var(--color-text)]">{t('provider.selectPrompt')}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('provider.selectDescription')}</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {modelEditor ? (
        <ModelEditorDialog
          editor={modelEditor}
          onChange={(model) => setModelEditor((current) => current ? { ...current, model } : current)}
          onCancel={() => setModelEditor(null)}
          onSave={saveModelEditor}
        />
      ) : null}
    </div>
  );
}

function ModelEditorDialog({
  editor,
  onChange,
  onCancel,
  onSave,
}: {
  editor: ModelEditorState;
  onChange: (model: ProviderModelForm) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const imageEnabled = editor.model.imageInput === true;
  const { t } = useTranslation(['settings', 'common']);
  const [contextPresetOpen, setContextPresetOpen] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section role="dialog" aria-modal="true" aria-labelledby="model-editor-title" className="w-full max-w-[27rem] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xl">
        <h2 id="model-editor-title" className="sr-only">{editor.originalModelId ? t('settings:provider.editModel') : t('settings:provider.addModel')}</h2>

        <div className="space-y-4">
          {editor.originalModelId ? (
            <div>
              <p className="text-sm font-medium text-[var(--color-text-subtle)]">ID</p>
              <p className="mt-1.5 font-mono text-[15px] text-[var(--color-text-muted)]">{editor.model.modelId}</p>
            </div>
          ) : (
            <label className="block space-y-1.5 text-sm font-medium text-[var(--color-text-subtle)]">
              <span>ID</span>
              <input aria-label={t('settings:provider.modelId')} value={editor.model.modelId} onChange={(event) => onChange({ ...editor.model, modelId: event.target.value })} className={compactFieldClassName} />
            </label>
          )}

          <label className="block space-y-1.5 text-sm font-medium text-[var(--color-text-subtle)]">
            <span>{t('settings:provider.displayName')}</span>
            <input aria-label={t('settings:provider.displayName')} value={editor.model.displayName} onChange={(event) => onChange({ ...editor.model, displayName: event.target.value })} className={compactFieldClassName} />
          </label>

          <label className="block space-y-1.5 text-sm font-medium text-[var(--color-text-subtle)]">
            <span>{t('settings:provider.contextWindow')}</span>
            <div className="relative flex h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-app-bg)]/65 shadow-sm transition focus-within:border-[var(--color-focus)] focus-within:ring-2 focus-within:ring-[var(--color-focus)]/20">
              <input
                aria-label={t('settings:provider.contextWindow')}
                type="number"
                min={1}
                step={1}
                value={editor.model.contextWindowTokens}
                onChange={(event) => onChange({ ...editor.model, contextWindowTokens: event.target.value })}
                className="peer min-w-0 flex-1 bg-transparent px-3 font-mono text-[15px] text-[var(--color-text)] outline-none [&::-webkit-inner-spin-button]:opacity-0 hover:[&::-webkit-inner-spin-button]:opacity-100 focus:[&::-webkit-inner-spin-button]:opacity-100"
              />
              <button
                type="button"
                aria-label={t('settings:provider.openContextPresets')}
                aria-haspopup="listbox"
                aria-expanded={contextPresetOpen}
                onClick={() => setContextPresetOpen((open) => !open)}
                className="grid w-9 shrink-0 place-items-center border-l border-[var(--color-border)] text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]"
              >
                <ChevronDown size={15} aria-hidden="true" className={cx('transition-transform', contextPresetOpen ? 'rotate-180' : undefined)} />
              </button>
              {contextPresetOpen ? (
                <div role="listbox" aria-label={t('settings:provider.contextPresets')} className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-10 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] py-1.5 shadow-xl">
                  {contextWindowPresets.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      role="option"
                      aria-selected={editor.model.contextWindowTokens === String(preset.value)}
                      onClick={() => {
                        onChange({ ...editor.model, contextWindowTokens: String(preset.value) });
                        setContextPresetOpen(false);
                      }}
                      className={cx(
                        'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition',
                        editor.model.contextWindowTokens === String(preset.value)
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]',
                      )}
                    >
                      <span className="font-medium">{preset.label}</span>
                      <span className="font-mono text-xs opacity-75">{formatNumber(preset.value)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </label>

          {editor.originalModelId ? (
            <div className="flex items-end justify-between border-t border-[var(--color-border)] pt-3">
              <p className="pb-0.5 text-sm font-medium text-[var(--color-text-subtle)]">{t('settings:provider.imageInput')}</p>
              <button
                type="button"
                role="switch"
                aria-label={t('settings:provider.imageInput')}
                aria-checked={imageEnabled}
                onClick={() => {
                  const next = !imageEnabled;
                  onChange({ ...editor.model, imageInput: next, imageInputOverride: next });
                }}
                className={cx(
                  'relative mb-0.5 h-5 w-9 rounded-full border transition',
                  imageEnabled
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-muted)]',
                )}
              >
                <span className={cx('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all', imageEnabled ? 'left-[1.05rem]' : 'left-0.5')} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onCancel}>{t('common:actions.cancel')}</Button>
          <Button type="button" variant="primary" onClick={onSave}>{editor.originalModelId ? t('settings:provider.done') : t('settings:provider.addAction')}</Button>
        </div>
      </section>
    </div>
  );
}

const fieldClassName = 'h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-app-bg)]/65 px-3 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20 disabled:cursor-not-allowed disabled:opacity-60';
const compactFieldClassName = 'h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-app-bg)]/65 px-3 text-[15px] text-[var(--color-text)] shadow-sm outline-none transition placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20';

function ProviderListItem({ entry, modelCount, selected, onClick }: { entry: ProviderListEntry; modelCount: number; selected: boolean; onClick: () => void }) {
  const { t } = useTranslation('settings');
  const enabled = entry.source !== 'saved' || entry.provider.enabled;
  return (
    <button type="button" onClick={onClick} className={cx(
      'relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
      selected ? 'bg-[var(--color-surface-elevated)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-elevated)]/70 hover:text-[var(--color-text)]',
      entry.source === 'quick' ? selected ? 'opacity-75' : 'opacity-55 hover:opacity-80' : undefined,
    )}>
      {selected ? <span className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-[var(--color-accent)]" /> : null}
      <span className={providerIconClassName(selected)}><Bot size={18} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{entry.displayName}</span>
        {!enabled ? <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">{t('provider.disabled')}</span> : null}
      </span>
      <span className="rounded-md bg-[var(--color-accent-soft)] px-2 py-1 text-xs font-medium text-[var(--color-accent)]">{t('provider.modelCount', { count: modelCount })}</span>
    </button>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-4">
      <span className="pt-0.5 text-sm font-medium text-[var(--color-text-muted)]">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function FormGroup({ title, bordered = false, children }: { title: string; bordered?: boolean; children: ReactNode }) {
  return (
    <section className={cx('space-y-3 p-4', bordered ? 'border-t border-[var(--color-border)]' : undefined)}>
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">{title}</h3>
      {children}
    </section>
  );
}
