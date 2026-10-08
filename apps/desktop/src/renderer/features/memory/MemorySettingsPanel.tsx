/* Edits application-wide memory switches and explicit production model bindings. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsSnapshot } from '@megumi/application/settings/settings-contracts';
import { Button, Select, SettingsPageHeader, SettingsSection } from '../../shared/ui';

type ModelOption = {
  value: string;
  label: string;
  providerId: string;
  modelId: string;
};

const modelValue = (model?: { providerId: string; modelId: string }) =>
  model ? `${model.providerId}/${model.modelId}` : '';

/** Saves switches and model choices together under the Settings revision contract. */
export function MemorySettingsPanel() {
  const { t } = useTranslation('settings');
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [generate, setGenerate] = useState(true);
  const [use, setUse] = useState(true);
  const [extract, setExtract] = useState('');
  const [consolidate, setConsolidate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([window.megumi.settings.readSettings(), window.megumi.models.getCatalog()])
      .then(([settings, catalog]) => {
        if (!active) return;
        if (!settings.ok) throw new Error(settings.data.message);
        if (!catalog.ok) throw new Error(catalog.data.message);
        if (catalog.data.status === 'failed') throw new Error(catalog.data.failure.message);

        setSnapshot(settings.data);
        setGenerate(settings.data.config.memory.generateMemories);
        setUse(settings.data.config.memory.useMemories);
        setExtract(modelValue(settings.data.config.memory.extractModel));
        setConsolidate(modelValue(settings.data.config.memory.consolidationModel));
        setModels(
          catalog.data.providers.flatMap(provider =>
            provider.models.map(({ model }) => ({
              value: `${provider.id}/${model.id}`,
              label: model.name,
              providerId: provider.id,
              modelId: model.id,
            })),
          ),
        );
      })
      .catch(error => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const saved = snapshot?.config.memory;
  const dirty =
    saved &&
    (generate !== saved.generateMemories ||
      use !== saved.useMemories ||
      extract !== modelValue(saved.extractModel) ||
      consolidate !== modelValue(saved.consolidationModel));
  const options = (selected: string) => [
    {
      value: '',
      label: t('memory.unbound'),
    },
    ...(selected && !models.some(model => model.value === selected)
      ? [
          {
            value: selected,
            label: t('discovery.modelUnavailable'),
          },
        ]
      : []),
    ...models,
  ];
  /** Keeps a missing saved binding until the user explicitly chooses another option. */
  const binding = (
    value: string,
    previous:
      | {
          providerId: string;
          modelId: string;
        }
      | undefined,
  ) => {
    const selected = models.find(model => model.value === value);
    return selected
      ? {
          providerId: selected.providerId,
          modelId: selected.modelId,
        }
      : value
        ? previous
        : null;
  };

  async function save() {
    if (!snapshot) return;

    setSaving(true);
    setError('');

    try {
      const result = await window.megumi.settings.updateSettings({
        expectedRevision: snapshot.revision,
        patch: {
          memory: {
            generateMemories: generate,
            useMemories: use,
            extractModel: binding(extract, snapshot.config.memory.extractModel),
            consolidationModel: binding(consolidate, snapshot.config.memory.consolidationModel),
          },
        },
      });
      if (!result.ok) setError(result.data.message);
      else setSnapshot(result.data.settings);
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('categories.memory.label')}
        description={t('categories.memory.description')}
      />
      <SettingsSection title={t('memory.automatic')}>
        <div className="space-y-5 p-5">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={generate}
              disabled={!snapshot || saving}
              onChange={event => setGenerate(event.target.checked)}
            />
            {t('memory.generate')}
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={use}
              disabled={!snapshot || saving}
              onChange={event => setUse(event.target.checked)}
            />
            {t('memory.use')}
          </label>
          <p className="text-sm text-[var(--color-text-muted)]">{t('memory.switchHelp')}</p>
          <Select
            label={t('memory.extractModel')}
            value={extract}
            onValueChange={setExtract}
            options={options(extract)}
            disabled={!snapshot || saving}
          />
          <Select
            label={t('memory.consolidationModel')}
            value={consolidate}
            onValueChange={setConsolidate}
            options={options(consolidate)}
            disabled={!snapshot || saving}
          />
          <p className="text-sm text-[var(--color-text-muted)]">{t('memory.modelHelp')}</p>
          {error && (
            <p role="alert" className="text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {t('provider.save')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
