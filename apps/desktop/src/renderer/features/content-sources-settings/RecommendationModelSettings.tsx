/* Edits the independent task model choices using the shared added-model list. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsSnapshot } from '@megumi/application/settings/settings-contracts';
import { Button, Select } from '../../shared/ui';

type ModelReference = { providerId: string; modelId: string };
type ModelOption = ModelReference & { value: string; label: string };
const valueOf = (model?: ModelReference) => (model ? `${model.providerId}/${model.modelId}` : '');

export function RecommendationModelSettings() {
  const { t } = useTranslation('settings');
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [recommendation, setRecommendation] = useState('');
  const [candidate, setCandidate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let disposed = false;
    void Promise.all([window.megumi.settings.readSettings(), window.megumi.models.getCatalog()])
      .then(([settings, catalog]) => {
        if (disposed) return;
        if (!settings.ok) {
          setError(settings.data.message);
          return;
        }
        if (!catalog.ok) {
          setError(catalog.data.message);
          return;
        }
        if (catalog.data.status === 'failed') {
          setError(catalog.data.failure.message);
          return;
        }
        setSnapshot(settings.data);
        setRecommendation(valueOf(settings.data.config.discovery.recommendationModel));
        setCandidate(valueOf(settings.data.config.discovery.candidateSupplyModel));
        setModels(
          catalog.data.providers.flatMap((provider) =>
            provider.models.map(({ model }) => ({
              providerId: provider.id,
              modelId: model.id,
              value: `${provider.id}/${model.id}`,
              label: model.name.trim().replace(/\s+/g, '-'),
            })),
          ),
        );
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      });
    return () => {
      disposed = true;
    };
  }, []);

  async function save() {
    if (!snapshot) return;
    const reference = (value: string) => {
      const model = models.find((model) => model.value === value);
      return model ? { providerId: model.providerId, modelId: model.modelId } : null;
    };
    setSaving(true);
    setError('');
    try {
      const result = await window.megumi.settings.updateSettings({
        expectedRevision: snapshot.revision,
        patch: {
          discovery: {
            ...(recommendation !== valueOf(snapshot.config.discovery.recommendationModel)
              ? { recommendationModel: reference(recommendation) }
              : {}),
            ...(candidate !== valueOf(snapshot.config.discovery.candidateSupplyModel)
              ? { candidateSupplyModel: reference(candidate) }
              : {}),
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
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('discovery.models')}</h2>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        {[
          {
            id: 'recommendation',
            label: t('discovery.recommendationModel'),
            value: recommendation,
            change: setRecommendation,
          },
          {
            id: 'candidate',
            label: t('discovery.candidateSupplyModel'),
            value: candidate,
            change: setCandidate,
          },
        ].map((field) => (
          <Select
            key={field.id}
            label={field.label}
            value={field.value}
            onValueChange={field.change}
            disabled={!snapshot || saving}
            options={[
              { value: '', label: t('discovery.selectModel') },
              ...(field.value && !models.some((model) => model.value === field.value)
                ? [{ value: field.value, label: t('discovery.modelUnavailable') }]
                : []),
              ...models,
            ]}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 rounded-b-xl border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-3">
        <div className="min-w-0 text-sm">
          {models.length === 0 && snapshot ? (
            <p className="text-[var(--color-text-muted)]">{t('discovery.noModels')}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
        </div>
        <Button variant="primary" onClick={() => void save()} disabled={!snapshot || saving}>
          {t('provider.save')}
        </Button>
      </div>
    </section>
  );
}
