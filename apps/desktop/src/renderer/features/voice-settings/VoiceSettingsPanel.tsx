/* Owns Voice model resources and voice-profile configuration in the main Settings surface. */
import type { VoiceHostModelStatus, VoiceHostProfile } from '@megumi/product/host';
import { Check, CircleCheck, Download, LoaderCircle, Plus, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SettingsPageHeader, SettingsSection } from '../../shared/ui';

export function VoiceSettingsPanel() {
  const { t } = useTranslation('settings');
  const [profiles, setProfiles] = useState<VoiceHostProfile[]>([]);
  const [modelStatus, setModelStatus] = useState<VoiceHostModelStatus>();
  const [profileName, setProfileName] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshProfiles = useCallback(async () => {
    const result = await window.megumi.voice.listProfiles(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.profilesList, {}),
    );
    if (result.ok && result.data.status === 'ok') setProfiles(result.data.profiles);
  }, []);

  const refreshModelStatus = useCallback(async () => {
    const result = await window.megumi.voice.getModelStatus(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelStatus, {}),
    );
    if (result.ok) setModelStatus(result.data);
  }, []);

  useEffect(() => { void refreshProfiles(); }, [refreshProfiles]);
  useEffect(() => {
    void (async () => {
      await window.megumi.voice.checkModelUpdates(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelsCheckUpdates, {}),
      );
      await refreshModelStatus();
    })();
  }, [refreshModelStatus]);
  useEffect(() => {
    if (modelStatus?.status !== 'preparing') return undefined;
    const timer = window.setInterval(() => { void refreshModelStatus(); }, 500);
    return () => window.clearInterval(timer);
  }, [modelStatus?.status, refreshModelStatus]);

  const prepareModels = async () => {
    if (modelStatus?.status === 'preparing') return;
    const preparation = window.megumi.voice.prepareModels(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelsPrepare, {
        repair: modelStatus?.status === 'failed' || modelStatus?.status === 'ready',
      }),
    );
    await refreshModelStatus();
    await preparation;
    await refreshModelStatus();
  };

  const cancelModelPreparation = async () => {
    await window.megumi.voice.cancelModelPreparation(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelsCancel, {}),
    );
    await refreshModelStatus();
  };

  const selectProfile = async (profileId: string) => {
    await window.megumi.voice.selectProfile(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.profileSelect, { profileId }),
    );
    await refreshProfiles();
  };

  const importProfile = async () => {
    const name = profileName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const result = await window.megumi.voice.importProfile(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.profileImport, { name }),
      );
      if (result.ok && result.data.status === 'ok') {
        setProfileName('');
        await refreshProfiles();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('categories.voice.label')}
        description={t('categories.voice.description')}
      />

      <SettingsSection title={t('voice.modelsTitle')} description={t('voice.modelsDescription')}>
        <div className="flex items-center gap-4 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            {modelStatus?.status === 'ready'
              ? <CircleCheck size={19} aria-hidden="true" />
              : modelStatus?.status === 'preparing'
                ? <LoaderCircle className="animate-spin" size={19} aria-hidden="true" />
                : <Download size={19} aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--color-text)]">{t(modelStatusKey(modelStatus))}</p>
              {modelStatus?.status === 'preparing' && modelStatus.phase === 'downloading' ? (
                <span className="text-xs font-semibold tabular-nums text-[var(--color-text)]">
                  {Math.round(modelStatus.progress * 100)}%
                </span>
              ) : null}
            </div>
            {modelStatus && 'totalBytes' in modelStatus ? (
              <p className="mt-1 text-xs tabular-nums text-[var(--color-text-muted)]">
                {formatBytes(modelStatus.downloadedBytes)} / {formatBytes(modelStatus.totalBytes)}
                {modelStatus.status === 'preparing' && modelStatus.phase === 'downloading' && modelStatus.bytesPerSecond
                  ? ` · ${formatBytes(modelStatus.bytesPerSecond)}/s`
                  : ''}
              </p>
            ) : null}
            {modelStatus?.status === 'preparing' && modelStatus.phase === 'downloading' ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
                  style={{ width: `${Math.round(modelStatus.progress * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
          {modelStatus?.status === 'preparing' ? (
            <Button type="button" onClick={() => { void cancelModelPreparation(); }}>
              <X size={15} aria-hidden="true" />{t('voice.modelsCancel')}
            </Button>
          ) : modelStatus ? (
            <Button
              type="button"
              disabled={modelStatus.status === 'ready' && !modelStatus.availableBundleVersion}
              onClick={() => { void prepareModels(); }}
            >
              <Download size={15} aria-hidden="true" />
              {modelStatus.status === 'ready'
                ? t(modelStatus.availableBundleVersion ? 'voice.modelsUpdate' : 'voice.modelsReady')
                : t(modelStatus.downloadedBytes > 0 ? 'voice.modelsResume' : 'voice.modelsDownload')}
            </Button>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title={t('voice.savedTitle')} description={t('voice.savedDescription')}>
        <div className="divide-y divide-[var(--color-border)]">
          {profiles.length === 0 ? (
            <p className="px-5 py-6 text-sm text-[var(--color-text-muted)]">{t('voice.empty')}</p>
          ) : profiles.map((profile) => (
            <button
              key={profile.profileId}
              type="button"
              className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[var(--color-surface-muted)]"
              onClick={() => { void selectProfile(profile.profileId); }}
            >
              <span className="grid size-9 place-items-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <Volume2 size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]">{profile.name}</span>
              {profile.selected ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-success)]">
                  <Check size={14} aria-hidden="true" />{t('voice.selected')}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('voice.addTitle')} description={t('voice.addDescription')}>
        <div className="flex items-end gap-3 p-5">
          <label className="min-w-0 flex-1 text-sm font-medium text-[var(--color-text)]">
            {t('voice.name')}
            <input
              className="mt-2 h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-app-bg)] px-3 text-sm font-normal outline-none focus:border-[var(--color-focus)]"
              value={profileName}
              placeholder={t('voice.namePlaceholder')}
              onChange={(event) => setProfileName(event.target.value)}
            />
          </label>
          <Button type="button" className="h-10" disabled={!profileName.trim() || busy} onClick={() => { void importProfile(); }}>
            <Plus size={15} aria-hidden="true" />
            {busy ? t('voice.adding') : t('voice.add')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}

function modelStatusKey(status: VoiceHostModelStatus | undefined):
  | 'voice.modelsChecking'
  | 'voice.modelsUpdateAvailable'
  | 'voice.modelsInstalled'
  | 'voice.modelsFailed'
  | 'voice.modelsPaused'
  | 'voice.modelsNotInstalled'
  | 'voice.modelsVerifying'
  | 'voice.modelsInstalling'
  | 'voice.modelsDownloading' {
  if (!status) return 'voice.modelsChecking';
  if (status.status === 'ready') return status.availableBundleVersion ? 'voice.modelsUpdateAvailable' : 'voice.modelsInstalled';
  if (status.status === 'failed') return 'voice.modelsFailed';
  if (status.status === 'not_prepared') return status.downloadedBytes > 0 ? 'voice.modelsPaused' : 'voice.modelsNotInstalled';
  if (status.phase === 'verifying') return 'voice.modelsVerifying';
  if (status.phase === 'installing') return 'voice.modelsInstalling';
  return 'voice.modelsDownloading';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(1)} ${unit}`;
}
