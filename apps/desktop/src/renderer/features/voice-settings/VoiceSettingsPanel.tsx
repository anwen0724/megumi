/* Owns Voice model resources and voice-profile configuration in the main Settings surface. */
import type { VoiceHostModelStatus, VoiceHostProfile } from '@megumi/product/host';
import { Activity, Check, CircleCheck, Download, Headphones, LoaderCircle, Mic2, Play, Plus, RefreshCw, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SettingsPageHeader, SettingsSection } from '../../shared/ui';
import { createSpeechPlaybackController } from '../character-presence/speech-playback-controller';
import {
  enumerateAudioDevices,
  testMicrophoneLevel,
  type AudioDeviceCatalog,
  type AudioDeviceOption,
} from './audio-devices';

type VoiceSettings = {
  readonly inputDeviceId: string;
  readonly outputDeviceId: string;
  readonly recognitionLanguage: 'auto' | 'zh' | 'en';
};

export function VoiceSettingsPanel() {
  const { t } = useTranslation('settings');
  const [profiles, setProfiles] = useState<VoiceHostProfile[]>([]);
  const [modelStatus, setModelStatus] = useState<VoiceHostModelStatus>();
  const [profileName, setProfileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    inputDeviceId: 'default',
    outputDeviceId: 'default',
    recognitionLanguage: 'auto',
  });
  const [devices, setDevices] = useState<AudioDeviceCatalog>({
    inputs: [{ deviceId: 'default', label: 'System default' }],
    outputs: [{ deviceId: 'default', label: 'System default' }],
  });
  const [devicesBusy, setDevicesBusy] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [previewingProfileId, setPreviewingProfileId] = useState<string | null>(null);

  const refreshVoiceSettings = useCallback(async () => {
    const result = await window.megumi.settings.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
    );
    if (result.ok && result.data.status === 'ok') setVoiceSettings(result.data.settings.voice);
  }, []);

  const refreshDevices = useCallback(async (requestPermission = false) => {
    setDevicesBusy(true);
    setDeviceError(null);
    try {
      setDevices(await enumerateAudioDevices({ requestPermission }));
    } catch {
      setDeviceError(t('voice.devicesError'));
    } finally {
      setDevicesBusy(false);
    }
  }, [t]);

  const updateVoiceSettings = async (patch: Partial<VoiceSettings>) => {
    const result = await window.megumi.settings.update(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, { voice: patch }),
    );
    if (result.ok && result.data.status === 'updated') {
      setVoiceSettings(result.data.settings.voice);
      setDeviceError(null);
      return;
    }
    setDeviceError(t('voice.devicesSaveError'));
  };

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
  useEffect(() => { void refreshVoiceSettings(); }, [refreshVoiceSettings]);
  useEffect(() => { void refreshDevices(false); }, [refreshDevices]);
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

  const previewProfile = async (profile: VoiceHostProfile) => {
    if (previewingProfileId) return;
    if (modelStatus?.status !== 'ready') {
      setDeviceError(t('voice.previewModelsRequired'));
      return;
    }
    setPreviewingProfileId(profile.profileId);
    setDeviceError(null);
    const result = await window.megumi.voice.previewProfile(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.profilePreview, { profileId: profile.profileId }),
    );
    if (!result.ok || result.data.status !== 'ok') {
      const message = result.ok && result.data.status === 'failed' ? result.data.failure.message : '';
      setDeviceError(isSidecarVersionFailure(message)
        ? t('voice.componentOutdated')
        : t('voice.previewFailed'));
      setPreviewingProfileId(null);
      return;
    }
    const playback = createSpeechPlaybackController({
      outputDeviceId: voiceSettings.outputDeviceId,
      report: (playbackResult) => {
        if (playbackResult.status === 'failed') setDeviceError(t('voice.previewPlaybackFailed'));
        setPreviewingProfileId(null);
        queueMicrotask(() => { void playback.dispose(); });
      },
    });
    for (const chunk of result.data.chunks) {
      playback.acceptChunk({ segmentId: `voice-preview:${profile.profileId}`, ...chunk });
    }
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

  const runMicrophoneTest = async () => {
    if (testingMicrophone) return;
    setTestingMicrophone(true);
    setDeviceError(null);
    try {
      await testMicrophoneLevel({
        deviceId: voiceSettings.inputDeviceId,
        onLevel: setMicrophoneLevel,
      });
      await refreshDevices(false);
    } catch {
      setDeviceError(t('voice.microphoneTestError'));
    } finally {
      setTestingMicrophone(false);
      setMicrophoneLevel(0);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <SettingsPageHeader
        title={t('categories.voice.label')}
        description={t('categories.voice.description')}
      />

      <SettingsSection title={t('voice.devicesTitle')} description={t('voice.devicesDescription')}>
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <DeviceSelect
            icon={<Mic2 size={18} aria-hidden="true" />}
            label={t('voice.inputDevice')}
            value={voiceSettings.inputDeviceId}
            options={ensureSelectedDevice(devices.inputs, voiceSettings.inputDeviceId, t('voice.deviceUnavailable'))}
            defaultLabel={t('voice.systemDefault')}
            onChange={(inputDeviceId) => { void updateVoiceSettings({ inputDeviceId }); }}
          />
          <DeviceSelect
            icon={<Headphones size={18} aria-hidden="true" />}
            label={t('voice.outputDevice')}
            value={voiceSettings.outputDeviceId}
            options={ensureSelectedDevice(devices.outputs, voiceSettings.outputDeviceId, t('voice.deviceUnavailable'))}
            defaultLabel={t('voice.systemDefault')}
            onChange={(outputDeviceId) => { void updateVoiceSettings({ outputDeviceId }); }}
          />
          <label className="rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] p-4">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              {t('voice.recognitionLanguage')}
            </span>
            <select
              className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]"
              value={voiceSettings.recognitionLanguage}
              onChange={(event) => { void updateVoiceSettings({ recognitionLanguage: event.target.value as VoiceSettings['recognitionLanguage'] }); }}
            >
              <option value="auto">{t('voice.languageAuto')}</option>
              <option value="zh">{t('voice.languageChinese')}</option>
              <option value="en">{t('voice.languageEnglish')}</option>
            </select>
          </label>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <Activity size={17} className="text-[var(--color-accent)]" aria-hidden="true" />
                {t('voice.microphoneTest')}
              </span>
              <Button type="button" disabled={testingMicrophone} onClick={() => { void runMicrophoneTest(); }}>
                {testingMicrophone ? <LoaderCircle className="animate-spin" size={15} /> : <Mic2 size={15} />}
                {t(testingMicrophone ? 'voice.testingMicrophone' : 'voice.startMicrophoneTest')}
              </Button>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]" aria-label={t('voice.microphoneLevel')}>
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-75"
                style={{ width: `${Math.round(microphoneLevel * 100)}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-3">
          <p className="text-xs text-[var(--color-text-muted)]">{deviceError ?? t('voice.devicesApplyNextSession')}</p>
          <Button type="button" disabled={devicesBusy} onClick={() => { void refreshDevices(true); }}>
            <RefreshCw className={devicesBusy ? 'animate-spin' : ''} size={15} aria-hidden="true" />
            {t('voice.refreshDevices')}
          </Button>
        </div>
      </SettingsSection>

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
        <div
          data-testid="voice-profile-scroll"
          className="max-h-[22rem] divide-y divide-[var(--color-border)] overflow-y-auto overscroll-contain"
          style={{ scrollbarGutter: 'stable' }}
        >
          {profiles.length === 0 ? (
            <p className="px-5 py-6 text-sm text-[var(--color-text-muted)]">{t('voice.empty')}</p>
          ) : profiles.map((profile) => (
            <div
              key={profile.profileId}
              className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-[var(--color-surface-muted)]"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
                onClick={() => { void selectProfile(profile.profileId); }}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                  <Volume2 size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-text)]">{profile.name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{profileDescription(profile, t)}</span>
                </span>
                {profile.selected ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--color-success)]">
                    <Check size={14} aria-hidden="true" />{t('voice.selected')}
                  </span>
                ) : null}
              </button>
              <Button
                type="button"
                disabled={Boolean(previewingProfileId)}
                aria-label={t('voice.previewNamed', { name: profile.name })}
                onClick={() => { void previewProfile(profile); }}
              >
                {previewingProfileId === profile.profileId
                  ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" />
                  : <Play size={15} aria-hidden="true" />}
                {t(previewingProfileId === profile.profileId ? 'voice.previewing' : 'voice.preview')}
              </Button>
            </div>
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

function DeviceSelect(props: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly options: readonly AudioDeviceOption[];
  readonly defaultLabel: string;
  readonly onChange: (deviceId: string) => void;
}) {
  return (
    <label className="rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] p-4">
      <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
        <span className="text-[var(--color-accent)]">{props.icon}</span>
        {props.label}
      </span>
      <select
        className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.deviceId} value={option.deviceId}>
            {option.deviceId === 'default' ? props.defaultLabel : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ensureSelectedDevice(
  options: readonly AudioDeviceOption[],
  selectedDeviceId: string,
  unavailableLabel: string,
): readonly AudioDeviceOption[] {
  return options.some((option) => option.deviceId === selectedDeviceId)
    ? options
    : [...options, { deviceId: selectedDeviceId, label: unavailableLabel }];
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

function profileDescription(
  profile: VoiceHostProfile,
  t: ReturnType<typeof useTranslation<'settings'>>['t'],
): string {
  if (profile.source === 'custom') return t('voice.profileCustom');
  if (profile.language === 'zh' && profile.gender === 'female') return t('voice.profileChineseFemale');
  if (profile.language === 'zh' && profile.gender === 'male') return t('voice.profileChineseMale');
  if (profile.language === 'en' && profile.gender === 'female') return t('voice.profileEnglishFemale');
  if (profile.language === 'en' && profile.gender === 'male') return t('voice.profileEnglishMale');
  return t('voice.profileBuiltIn');
}

function isSidecarVersionFailure(message: string): boolean {
  return /protocol version|referenceAudioPath/i.test(message);
}
