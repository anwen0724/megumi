/* Presents all discovery-source configuration without exposing stored credentials. */
import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink, KeyRound, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DiscoveryConfigurationUiDto } from '@megumi/product-host/host';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SettingsPageHeader, SettingsSection, cx } from '../../shared/ui';
import { WebSettingsPanel } from '../web-settings';

type ProviderSourceId = 'zhihu' | 'twitter';
type BrowserSourceId = 'xiaohongshu' | 'douyin';
type SourceView = DiscoveryConfigurationUiDto['sources'][number];

export function ContentSourcesSettingsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const [configuration, setConfiguration] = useState<DiscoveryConfigurationUiDto | null>(null);
  const [configured, setConfigured] = useState<Record<ProviderSourceId, boolean>>({ zhihu: false, twitter: false });
  const [drafts, setDrafts] = useState<Record<ProviderSourceId, string>>({ zhihu: '', twitter: '' });
  const [busySource, setBusySource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.megumi.discovery.getConfiguration(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.discovery.configurationGet, {},
      )),
      ...(['zhihu', 'twitter'] as const).map((sourceId) => (
        window.megumi.settings.getDiscoverySourceCredentialStatus(createRendererRuntimeIpcRequest(
          IPC_CHANNELS.settings.discoveryCredentialGet, { sourceId },
        ))
      )),
    ]).then(([configurationResult, ...credentialResults]) => {
      if (cancelled) return;
      if (!configurationResult.ok) throw new Error(configurationResult.data.message);
      setConfiguration(configurationResult.data);
      setConfigured({
        zhihu: credentialConfigured(credentialResults[0]),
        twitter: credentialConfigured(credentialResults[1]),
      });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : t('settings:contentSources.loadFailed'));
    });
    return () => { cancelled = true; };
  }, [t]);

  async function saveCredential(sourceId: ProviderSourceId) {
    const credential = drafts[sourceId].trim();
    if (!credential) return;
    setBusySource(sourceId);
    setError(null);
    try {
      const result = await window.megumi.settings.setDiscoverySourceCredential(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.settings.discoveryCredentialSet, { sourceId, credential },
      ));
      if (!result.ok) throw new Error(result.data.message);
      if (result.data.status === 'failed') throw new Error(result.data.failure.message);
      const isConfigured = result.data.configured;
      setConfigured((current) => ({ ...current, [sourceId]: isConfigured }));
      setDrafts((current) => ({ ...current, [sourceId]: '' }));
      await refreshConfiguration();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings:contentSources.saveFailed'));
    } finally {
      setBusySource(null);
    }
  }

  async function clearCredential(sourceId: ProviderSourceId) {
    setBusySource(sourceId);
    setError(null);
    try {
      const result = await window.megumi.settings.deleteDiscoverySourceCredential(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.settings.discoveryCredentialDelete, { sourceId },
      ));
      if (!result.ok) throw new Error(result.data.message);
      if (result.data.status === 'failed') throw new Error(result.data.failure.message);
      setConfigured((current) => ({ ...current, [sourceId]: false }));
      setDrafts((current) => ({ ...current, [sourceId]: '' }));
      await refreshConfiguration();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings:contentSources.clearFailed'));
    } finally {
      setBusySource(null);
    }
  }

  async function connectSource(sourceId: BrowserSourceId) {
    setBusySource(sourceId);
    setError(null);
    try {
      const result = await window.megumi.discovery.connectSource(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.discovery.sourceConnect, { sourceId },
      ));
      if (!result.ok) throw new Error(result.data.message);
      setConfiguration((current) => current ? ({
        ...current,
        sources: current.sources.map((source) => source.sourceId === sourceId ? result.data : source),
      }) : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings:contentSources.loginFailed'));
    } finally {
      setBusySource(null);
    }
  }

  async function refreshConfiguration() {
    const result = await window.megumi.discovery.getConfiguration(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.discovery.configurationGet, {},
    ));
    if (result.ok) setConfiguration(result.data);
  }

  const source = (sourceId: string) => configuration?.sources.find((item) => item.sourceId === sourceId);

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('settings:categories.sources.label')}
        description={t('settings:categories.sources.description')}
      />

      <WebSettingsPanel showHeader={false} />

      <SettingsSection
        title={t('settings:contentSources.platformTitle')}
        description={t('settings:contentSources.platformDescription')}
      >
        <div className="divide-y divide-[var(--color-border)]">
          <StatusSourceRow source={source('bilibili')} />
          <BrowserSourceRow source={source('xiaohongshu')} busy={busySource === 'xiaohongshu'} onLogin={() => void connectSource('xiaohongshu')} />
          <BrowserSourceRow source={source('douyin')} busy={busySource === 'douyin'} onLogin={() => void connectSource('douyin')} />
          <CredentialSourceRow
            source={source('zhihu')}
            sourceId="zhihu"
            label="知乎 Access Secret"
            configured={configured.zhihu}
            value={drafts.zhihu}
            busy={busySource === 'zhihu'}
            onChange={(value) => setDrafts((current) => ({ ...current, zhihu: value }))}
            onSave={() => void saveCredential('zhihu')}
            onClear={() => void clearCredential('zhihu')}
          />
          <CredentialSourceRow
            source={source('twitter')}
            sourceId="twitter"
            label="TwitterAPI.io API Key"
            configured={configured.twitter}
            value={drafts.twitter}
            busy={busySource === 'twitter'}
            onChange={(value) => setDrafts((current) => ({ ...current, twitter: value }))}
            onSave={() => void saveCredential('twitter')}
            onClear={() => void clearCredential('twitter')}
          />
        </div>
      </SettingsSection>

      {error ? <p role="alert" className="rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

function credentialConfigured(result: Awaited<ReturnType<typeof window.megumi.settings.getDiscoverySourceCredentialStatus>> | undefined) {
  return Boolean(result?.ok && result.data.status === 'ok' && result.data.configured);
}

function SourceIdentity({ source }: { source?: SourceView }) {
  const { t } = useTranslation('settings');
  if (!source) return <span className="text-sm text-[var(--color-text-muted)]">{t('contentSources.loading')}</span>;
  const ready = source.connectionState === 'ready';
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[var(--color-text)]">{source.name}</span>
        <span className={cx(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium',
          ready ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
        )}>
          {ready ? <CheckCircle2 size={11} aria-hidden="true" /> : <CircleAlert size={11} aria-hidden="true" />}
          {t(`contentSources.states.${source.connectionState}`)}
        </span>
      </div>
    </div>
  );
}

function StatusSourceRow({ source }: { source?: SourceView }) {
  const { t } = useTranslation('settings');
  return <div className="flex min-h-20 items-center justify-between gap-4 px-5 py-4"><SourceIdentity source={source} /><span className="text-xs text-[var(--color-text-muted)]">{t('contentSources.noConfiguration')}</span></div>;
}

function BrowserSourceRow({ source, busy, onLogin }: { source?: SourceView; busy: boolean; onLogin(): void }) {
  const { t } = useTranslation('settings');
  return (
    <div data-source-id={source?.sourceId} className="flex min-h-20 items-center justify-between gap-4 px-5 py-4">
      <SourceIdentity source={source} />
      <Button type="button" variant="ghost" disabled={busy || !source} onClick={onLogin} aria-label={source ? t('contentSources.loginSource', { name: source.name }) : undefined}>
        <LogIn size={14} aria-hidden="true" />{busy ? t('contentSources.opening') : t('contentSources.login')}
      </Button>
    </div>
  );
}

function CredentialSourceRow(props: {
  source?: SourceView;
  sourceId: ProviderSourceId;
  label: string;
  configured: boolean;
  value: string;
  busy: boolean;
  onChange(value: string): void;
  onSave(): void;
  onClear(): void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div data-source-id={props.sourceId} className="px-5 py-5">
      <div className="flex items-center justify-between gap-4"><SourceIdentity source={props.source} /><span className="text-xs font-medium text-[var(--color-text-muted)]">{props.configured ? t('contentSources.configured') : t('contentSources.notConfigured')}</span></div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor={`source-credential-${props.sourceId}`} className="sr-only">{props.label}</label>
        <div className="relative min-w-56 flex-1">
          <KeyRound size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <input
            id={`source-credential-${props.sourceId}`}
            aria-label={props.label}
            type="password"
            value={props.value}
            disabled={props.busy}
            placeholder={props.configured ? t('contentSources.replaceCredential') : t('contentSources.enterCredential')}
            onChange={(event) => props.onChange(event.target.value)}
            className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] pl-9 pr-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
          />
        </div>
        <Button type="button" variant="ghost" disabled={props.busy || !props.configured} onClick={props.onClear}>{t('contentSources.clear')}</Button>
        <Button type="button" variant="primary" disabled={props.busy || !props.value.trim()} onClick={props.onSave} aria-label={t('contentSources.saveCredentialFor', { name: props.source?.name ?? props.sourceId })}>{t('contentSources.save')}</Button>
      </div>
      {props.sourceId === 'twitter' ? <a href="https://twitterapi.io/" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">TwitterAPI.io <ExternalLink size={11} aria-hidden="true" /></a> : null}
    </div>
  );
}
