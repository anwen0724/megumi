/* Edits the independent task model choices using the shared added-model list. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsSnapshot } from '@megumi/application/settings/settings-contracts';
import { Button, SettingsPageHeader, SettingsSection } from '../../shared/ui';

type ModelReference = { providerId: string; modelId: string };
type ModelOption = ModelReference & { value: string; label: string };
const valueOf = (model?: ModelReference) => (model ? `${model.providerId}/${model.modelId}` : '');

export function DiscoverySettingsPanel() {
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
              label: `${model.name} · ${provider.name}`,
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
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('categories.discovery.label')}
        description={t('categories.discovery.description')}
      />
      <SettingsSection title={t('discovery.models')}>
        <div className="space-y-5 p-5">
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
            <label key={field.id} className="block space-y-2 text-sm">
              <span>{field.label}</span>
              <select
                className="block w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
                value={field.value}
                onChange={(event) => field.change(event.target.value)}
                disabled={!snapshot || saving}
              >
                <option value="">{t('discovery.selectModel')}</option>
                {field.value && !models.some((model) => model.value === field.value) ? (
                  <option value={field.value} disabled>
                    {t('discovery.modelUnavailable')}
                  </option>
                ) : null}
                {models.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {models.length === 0 && snapshot ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t('discovery.noModels')}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
          <Button onClick={() => void save()} disabled={!snapshot || saving}>
            {t('provider.save')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
