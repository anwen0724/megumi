/* Manages user-visible Interests and renderer-safe daily discovery settings. */
import { useEffect, useState, type FormEvent } from 'react';
import { Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DiscoveryHomeUiResult, SettingsUiResolved } from '@megumi/product/host';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button, cx } from '../../../shared/ui';

interface InterestManagerProps {
  open: boolean;
  interests: DiscoveryHomeUiResult['interests'];
  onClose(): void;
  onChanged(): Promise<void>;
}

export function InterestManager({ open, interests, onClose, onChanged }: InterestManagerProps) {
  const { t } = useTranslation('discovery');
  const [newInterest, setNewInterest] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<SettingsUiResolved['discovery'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDrafts(Object.fromEntries(interests.map((interest) => [interest.interestId, interest.description])));
    setSaved(false);
    void loadSettings();
  }, [open, interests]);

  async function loadSettings() {
    const result = await window.megumi.settings.get(createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}));
    if (result.ok && result.data.status === 'ok') setSettings(result.data.settings.discovery);
    else setError(t('loadFailed'));
  }

  async function changeInterest(payload: Parameters<typeof window.megumi.discovery.changeInterest>[0]['payload']) {
    setBusy(true);
    setError(null);
    const result = await window.megumi.discovery.changeInterest(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.interestChange, payload),
    );
    setBusy(false);
    if (!result.ok) {
      setError(t('actionFailed'));
      return false;
    }
    await onChanged();
    return true;
  }

  async function addInterest(event: FormEvent) {
    event.preventDefault();
    const description = newInterest.trim();
    if (!description) return;
    if (await changeInterest({ action: 'create', description })) setNewInterest('');
  }

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await window.megumi.settings.update(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.settings.update,
      { discovery: settings },
    ));
    setBusy(false);
    if (!result.ok || result.data.status === 'failed') {
      setError(t('actionFailed'));
      return;
    }
    setSettings(result.data.settings.discovery);
    setSaved(true);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="interest-manager-title"
        className="h-full w-full max-w-[34rem] overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-app-bg)] shadow-[-24px_0_60px_rgba(0,0,0,0.12)]"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-[var(--color-border)] bg-[var(--color-app-bg)]/95 px-6 py-5 backdrop-blur">
          <div>
            <h2 id="interest-manager-title" className="text-xl font-semibold tracking-[-0.025em] text-[var(--color-text)]">{t('managementTitle')}</h2>
            <p className="mt-1 max-w-md text-sm leading-5 text-[var(--color-text-muted)]">{t('managementDescription')}</p>
          </div>
          <button type="button" aria-label={t('close')} onClick={onClose} className="rounded-full p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-8 p-6">
          <section>
            <form onSubmit={(event) => void addInterest(event)} className="flex gap-2">
              <label className="sr-only" htmlFor="new-discovery-interest">{t('addInterestLabel')}</label>
              <input
                id="new-discovery-interest"
                aria-label={t('addInterestLabel')}
                value={newInterest}
                disabled={busy}
                onChange={(event) => setNewInterest(event.target.value)}
                placeholder={t('addInterestPlaceholder')}
                className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
              />
              <Button type="submit" variant="primary" disabled={busy || !newInterest.trim()}><Plus size={15} />{t('add')}</Button>
            </form>

            <div className="mt-4 space-y-2.5">
              {interests.map((interest) => (
                <div key={interest.interestId} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
                  <div className="flex items-start gap-2">
                    <textarea
                      aria-label={interest.description}
                      rows={2}
                      value={drafts[interest.interestId] ?? interest.description}
                      disabled={busy}
                      onChange={(event) => setDrafts((value) => ({ ...value, [interest.interestId]: event.target.value }))}
                      className="min-w-0 flex-1 resize-none rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm leading-5 text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]"
                    />
                    <button type="button" aria-label={`${t('delete')} ${interest.description}`} disabled={busy} onClick={() => void changeInterest({ action: 'delete', interestId: interest.interestId })} className="rounded-lg p-2 text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[0.7rem] text-[var(--color-text-subtle)]">
                      <span>{t(interest.createdFrom)}</span>
                      <span>·</span>
                      <span className={interest.status === 'active' ? 'text-[var(--color-success)]' : ''}>{t(interest.status)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {drafts[interest.interestId]?.trim() !== interest.description ? (
                        <Button size="sm" disabled={busy || !drafts[interest.interestId]?.trim()} onClick={() => void changeInterest({ action: 'update', interestId: interest.interestId, description: drafts[interest.interestId].trim() })}>{t('update')}</Button>
                      ) : null}
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void changeInterest({ action: interest.status === 'active' ? 'pause' : 'resume', interestId: interest.interestId })}>
                        {interest.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                        {t(interest.status === 'active' ? 'pause' : 'resume')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {settings ? (
            <section className="rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-base font-semibold text-[var(--color-text)]">{t('settingsTitle')}</h3>
              <div className="mt-4 space-y-4">
                <label className="flex items-center justify-between gap-4 text-sm text-[var(--color-text)]">
                  <span>{t('recognition')}</span>
                  <input type="checkbox" checked={settings.conversationRecognitionEnabled} onChange={(event) => setSettings({ ...settings, conversationRecognitionEnabled: event.target.checked })} />
                </label>
                <label className="grid grid-cols-[1fr_8rem] items-center gap-4 text-sm text-[var(--color-text)]">
                  <span>{t('generationTime')}</span>
                  <input type="time" value={settings.dailyGenerationTime} onChange={(event) => setSettings({ ...settings, dailyGenerationTime: event.target.value })} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2" />
                </label>
                <label className="grid grid-cols-[1fr_8rem] items-center gap-4 text-sm text-[var(--color-text)]">
                  <span>{t('targetCount')}</span>
                  <input aria-label={t('targetCount')} type="number" min={1} max={100} value={settings.dailyTargetCount} onChange={(event) => setSettings({ ...settings, dailyTargetCount: Number(event.target.value) })} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2" />
                </label>
                <fieldset>
                  <legend className="mb-2 text-sm text-[var(--color-text)]">{t('sources')}</legend>
                  <div className="flex gap-4 text-sm text-[var(--color-text-muted)]">
                    {(['bilibili', 'open_web'] as const).map((sourceId) => (
                      <label key={sourceId} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={settings.enabledSources.includes(sourceId)}
                          onChange={(event) => setSettings({
                            ...settings,
                            enabledSources: event.target.checked
                              ? [...new Set([...settings.enabledSources, sourceId])]
                              : settings.enabledSources.filter((value) => value !== sourceId),
                          })}
                        />
                        {t(sourceId === 'open_web' ? 'openWeb' : 'bilibili')}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="mt-5 flex items-center justify-end gap-3">
                {saved ? <span className="text-xs text-[var(--color-success)]">{t('saved')}</span> : null}
                <Button variant="primary" disabled={busy || settings.enabledSources.length === 0 || settings.dailyTargetCount < 1 || settings.dailyTargetCount > 100} onClick={() => void saveSettings()}>{t('saveSettings')}</Button>
              </div>
            </section>
          ) : null}

          {error ? <p role="alert" className={cx('rounded-xl px-4 py-3 text-sm', 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]')}>{error}</p> : null}
        </div>
      </section>
    </div>
  );
}
