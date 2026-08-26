/*
 * Presents discovery-source availability, login actions, and local credentials.
 */
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  KeyRound,
  LogIn,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DiscoveryConfigurationUiDto } from '@megumi/product-host/host';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SecretInput, SettingsPageHeader, SettingsSection, cx } from '../../shared/ui';
import { WebSettingsPanel } from '../web-settings';

type ProviderSourceId = 'zhihu' | 'twitter';
type BrowserSourceId = 'xiaohongshu' | 'douyin';
type SourceView = DiscoveryConfigurationUiDto['sources'][number];

const providerSourceIds = ['zhihu', 'twitter'] as const;

/** Renders source availability, login actions, and API credential configuration. */
export function ContentSourcesSettingsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const [configuration, setConfiguration] = useState<DiscoveryConfigurationUiDto | null>(null);
  const [configured, setConfigured] = useState<Record<ProviderSourceId, boolean>>({ zhihu: false, twitter: false });
  const [drafts, setDrafts] = useState<Record<ProviderSourceId, string>>({ zhihu: '', twitter: '' });
  const [expandedSource, setExpandedSource] = useState<ProviderSourceId | null>(null);
  const [busySource, setBusySource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readConfiguration(),
      ...providerSourceIds.map(readCredential),
    ]).then(([configurationResult, ...credentialResults]) => {
      if (cancelled) return;
      setConfiguration(configurationResult);
      setConfigured({
        zhihu: credentialResults[0].configured,
        twitter: credentialResults[1].configured,
      });
      setDrafts({
        zhihu: credentialResults[0].credential,
        twitter: credentialResults[1].credential,
      });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : t('settings:contentSources.loadFailed'));
    });
    return () => { cancelled = true; };
  }, [t]);

  const waitingForInitialChecks = configuration?.sources.some(
    (source) => source.connectionState === 'unknown' && !source.checkedAt,
  ) ?? false;

  useEffect(() => {
    if (!waitingForInitialChecks) return undefined;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void readConfiguration().then(setConfiguration).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : t('settings:contentSources.loadFailed'));
      });
      if (attempts >= 20) window.clearInterval(timer);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [waitingForInitialChecks, t]);

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
      const configuredValue = result.data.configured;
      const storedCredential = result.data.credential ?? credential;
      setConfigured((current) => ({ ...current, [sourceId]: configuredValue }));
      setDrafts((current) => ({ ...current, [sourceId]: storedCredential }));
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

  async function refreshSources() {
    setBusySource('all');
    setError(null);
    try {
      const result = await window.megumi.discovery.refreshSources(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.discovery.sourcesRefresh, {},
      ));
      if (!result.ok) throw new Error(result.data.message);
      setConfiguration(result.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings:contentSources.loadFailed'));
    } finally {
      setBusySource(null);
    }
  }

  async function refreshConfiguration() {
    setConfiguration(await readConfiguration());
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
        headerAction={(
          <Button type="button" variant="ghost" disabled={busySource !== null} onClick={() => void refreshSources()}>
            <RefreshCw size={14} className={busySource === 'all' ? 'animate-spin' : undefined} aria-hidden="true" />
            {busySource === 'all' ? t('settings:contentSources.checking') : t('settings:contentSources.recheckAll')}
          </Button>
        )}
      >
        <div className="divide-y divide-[var(--color-border)]">
          <StatusSourceRow source={source('bilibili')} />
          <BrowserSourceRow source={source('xiaohongshu')} disabled={busySource !== null} opening={busySource === 'xiaohongshu'} onLogin={() => void connectSource('xiaohongshu')} />
          <BrowserSourceRow source={source('douyin')} disabled={busySource !== null} opening={busySource === 'douyin'} onLogin={() => void connectSource('douyin')} />
          <CredentialSourceRow
            source={source('zhihu')}
            sourceId="zhihu"
            label="知乎 Access Secret"
            configured={configured.zhihu}
            value={drafts.zhihu}
            expanded={expandedSource === 'zhihu'}
            busy={busySource === 'zhihu'}
            onToggle={() => setExpandedSource((current) => current === 'zhihu' ? null : 'zhihu')}
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
            expanded={expandedSource === 'twitter'}
            busy={busySource === 'twitter'}
            onToggle={() => setExpandedSource((current) => current === 'twitter' ? null : 'twitter')}
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

/** Reads one renderer-safe projection without initiating source work. */
async function readConfiguration(): Promise<DiscoveryConfigurationUiDto> {
  const result = await window.megumi.discovery.getConfiguration(createRendererRuntimeIpcRequest(
    IPC_CHANNELS.discovery.configurationGet, {},
  ));
  if (!result.ok) throw new Error(result.data.message);
  return result.data;
}

/** Reads one source secret through the dedicated credential boundary. */
async function readCredential(sourceId: ProviderSourceId): Promise<{ configured: boolean; credential: string }> {
  const result = await window.megumi.settings.getDiscoverySourceCredential(createRendererRuntimeIpcRequest(
    IPC_CHANNELS.settings.discoveryCredentialGet, { sourceId },
  ));
  if (!result.ok) throw new Error(result.data.message);
  if (result.data.status === 'failed') throw new Error(result.data.failure.message);
  return { configured: result.data.configured, credential: result.data.credential ?? '' };
}

function SourceIdentity({ source }: { source?: SourceView }) {
  const { t } = useTranslation('settings');
  if (!source) return <span className="text-sm text-[var(--color-text-muted)]">{t('contentSources.loading')}</span>;
  const ready = source.connectionState === 'ready';
  const stateLabel = source.connectionState === 'unknown' && source.checkedAt
    ? t('contentSources.checkFailed')
    : t(`contentSources.states.${source.connectionState}`);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[var(--color-text)]">{source.name}</span>
        <span className={cx(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium',
          ready ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
        )}>
          {ready ? <CheckCircle2 size={11} aria-hidden="true" /> : <CircleAlert size={11} aria-hidden="true" />}
          {stateLabel}{ready && source.provider ? `（${source.provider}）` : ''}
        </span>
      </div>
      {source.checkedAt ? <p className="mt-1 text-[0.7rem] text-[var(--color-text-subtle)]">{t('contentSources.checkedAt', { time: formatSourceTime(source.checkedAt) })}</p> : null}
      {source.retryAt ? <p className="mt-0.5 text-[0.7rem] text-[var(--color-text-subtle)]">{t('contentSources.retryAt', { time: formatSourceTime(source.retryAt) })}</p> : null}
    </div>
  );
}

function StatusSourceRow({ source }: { source?: SourceView }) {
  const { t } = useTranslation('settings');
  return (
    <div className="flex min-h-20 items-center justify-between gap-4 px-5 py-4">
      <SourceIdentity source={source} />
      <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('contentSources.noConfiguration')}</span>
    </div>
  );
}

function BrowserSourceRow({ source, disabled, opening, onLogin }: {
  source?: SourceView;
  disabled: boolean;
  opening: boolean;
  onLogin(): void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div data-source-id={source?.sourceId} className="flex min-h-20 items-center justify-between gap-4 px-5 py-4">
      <SourceIdentity source={source} />
      <Button type="button" variant="ghost" disabled={disabled || !source} onClick={onLogin} aria-label={source ? t('contentSources.loginSource', { name: source.name }) : undefined}>
        <LogIn size={14} aria-hidden="true" />
        {opening ? t('contentSources.opening') : t('contentSources.login')}
      </Button>
    </div>
  );
}

function formatSourceTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

/** Keeps one provider source row stable while its credential editor expands inline. */
function CredentialSourceRow(props: {
  source?: SourceView;
  sourceId: ProviderSourceId;
  label: string;
  configured: boolean;
  value: string;
  expanded: boolean;
  busy: boolean;
  onToggle(): void;
  onChange(value: string): void;
  onSave(): void;
  onClear(): void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div data-source-id={props.sourceId}>
      <div className="flex min-h-20 items-center justify-between gap-4 px-5 py-4">
        <SourceIdentity source={props.source} />
        <Button type="button" variant="ghost" aria-expanded={props.expanded} aria-controls={`source-credential-panel-${props.sourceId}`} onClick={props.onToggle}>
          <Settings2 size={14} aria-hidden="true" />
          {t('contentSources.configure')}
          <ChevronDown size={14} aria-hidden="true" className={cx('transition-transform duration-200 motion-reduce:transition-none', props.expanded ? 'rotate-180' : undefined)} />
        </Button>
      </div>
      <div className={cx(
        'grid [overflow-anchor:none] transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        props.expanded ? 'grid-rows-[1fr]' : 'pointer-events-none grid-rows-[0fr]',
      )}>
        <div className="min-h-0 overflow-hidden">
          <div
            id={`source-credential-panel-${props.sourceId}`}
            aria-hidden={!props.expanded}
            className={cx(
              'bg-[var(--color-surface-muted)] transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
              props.expanded ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0',
            )}
          >
            <div className="grid grid-cols-1 gap-3 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <SecretInput
                ariaLabel={props.label}
                showLabel={t('provider.showApiKey')}
                hideLabel={t('provider.hideApiKey')}
                value={props.value}
                disabled={props.busy || !props.expanded}
                placeholder={t('contentSources.enterCredential')}
                onChange={props.onChange}
                leadingIcon={<KeyRound size={14} aria-hidden="true" />}
                className="min-w-0"
                inputClassName="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
              />
              <div className="flex items-center justify-end gap-2">
                <span className="mr-1 text-xs font-medium text-[var(--color-text-muted)]">
                  {props.configured ? t('contentSources.configured') : t('contentSources.notConfigured')}
                </span>
                <Button type="button" variant="ghost" disabled={props.busy || !props.configured || !props.expanded} onClick={props.onClear}>{t('contentSources.clear')}</Button>
                <Button type="button" variant="primary" disabled={props.busy || !props.value.trim() || !props.expanded} onClick={props.onSave} aria-label={t('contentSources.saveCredentialFor', { name: props.source?.name ?? props.sourceId })}>{t('contentSources.save')}</Button>
              </div>
            </div>
            {props.sourceId === 'twitter' ? (
              <a href="https://twitterapi.io/" target="_blank" rel="noreferrer" tabIndex={props.expanded ? 0 : -1} className="flex items-center gap-1 px-5 pb-4 text-xs text-[var(--color-accent)] hover:underline">
                {t('contentSources.twitterApiLink')} <ExternalLink size={11} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
