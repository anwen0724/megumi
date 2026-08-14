/* Owns Voice model resources and input device configuration in the main Settings surface. */
import type { VoiceHostModelStatus } from '@megumi/product/host';
import { Activity, CircleCheck, Download, LoaderCircle, Mic2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SettingsPageHeader, SettingsSection } from '../../shared/ui';
import {
  enumerateAudioDevices,
  testMicrophoneLevel,
  type AudioDeviceCatalog,
  type AudioDeviceOption,
} from './audio-devices';

type VoiceSettings = {
  readonly inputDeviceId: string;
  readonly recognitionLanguage: 'auto' | 'zh' | 'en';
};

export function VoiceSettingsPanel() {
  const { t } = useTranslation('settings');
  const [modelStatus, setModelStatus] = useState<VoiceHostModelStatus>();
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    inputDeviceId: 'default',
    recognitionLanguage: 'auto',
  });
  const [devices, setDevices] = useState<AudioDeviceCatalog>({
    inputs: [{ deviceId: 'default', label: 'System default' }],
  });
  const [devicesBusy, setDevicesBusy] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [testingMicrophone, setTestingMicrophone] = useState(false);

  const refreshVoiceSettings = useCallback(async () => {
    const result = await window.megumi.settings.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
    );
    if (result.ok && result.data.status === 'ok') {
      const { inputDeviceId, recognitionLanguage } = result.data.settings.voice;
      setVoiceSettings({ inputDeviceId, recognitionLanguage });
    }
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
      const { inputDeviceId, recognitionLanguage } = result.data.settings.voice;
      setVoiceSettings({ inputDeviceId, recognitionLanguage });
      setDeviceError(null);
      return;
    }
    setDeviceError(t('voice.devicesSaveError'));
  };

  const refreshModelStatus = useCallback(async () => {
    const result = await window.megumi.voice.getModelStatus(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.modelStatus, {}),
    );
    if (result.ok) setModelStatus(result.data);
  }, []);

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
