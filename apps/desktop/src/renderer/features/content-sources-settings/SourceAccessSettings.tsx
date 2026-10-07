/* Shows cached source access and runs only explicit user checks. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceAccessRequest, SupplySourceView } from '@megumi/application/contracts';
import { IPC_CHANNELS } from '../../../main/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SettingsSection } from '../../shared/ui';

export function SourceAccessSettings() {
  const { t } = useTranslation('settings');
  const [sources, setSources] = useState<readonly SupplySourceView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<SourceAccessRequest['sourceId'] | null>(null);
  useEffect(() => {
    let active = true;
    async function read() {
      try {
        const result = await window.megumi.recommendation.getConfiguration(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.configurationGet, {}));
        if (!result.ok) throw new Error(result.data.message);
        if (active) setSources(result.data.sources);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : t('contentSources.loadFailed'));
      }
    }
    const refresh = () => { void read(); };
    refresh();
    const onFocus = () => {
      if (opened) { setOpened(null); void check(opened); } else refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.removeEventListener('focus', onFocus); };
  }, [t, opened]);

  async function check(sourceId: SourceAccessRequest['sourceId']) {
    setBusy(sourceId);
    setError(null);
    try {
      const result = await window.megumi.recommendation.checkSourceAccess(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.sourceAccess, { sourceId }));
      if (!result.ok) throw new Error(result.data.message);
      setSources((current) => current.map((source) => source.sourceId === sourceId ? { ...source, ...result.data } : source));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('contentSources.loadFailed')); }
    finally { setBusy(null); }
  }

  async function login(sourceId: SourceAccessRequest['sourceId']) {
    setBusy(sourceId);
    setError(null);
    setOpened(null);
    try {
      const result = await window.megumi.recommendation.openSourceLogin(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.sourceLogin, { sourceId }));
      if (!result.ok) throw new Error(result.data.message);
      if (result.data.status === 'rejected') throw new Error(result.data.error.message);
      setOpened(sourceId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('contentSources.loadFailed')); }
    finally { setBusy(null); }
  }

  return <SettingsSection title={t('contentSources.accessTitle')}>
    {sources.map((source) => <div key={source.sourceId} className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0 text-sm">
        <p>{source.name}</p>
        <p className="text-[var(--color-text-muted)]">{t(`contentSources.states.${source.state}`)}</p>
        {source.checkedAt ? <p className="text-xs">{t('contentSources.lastChecked')}: <time dateTime={source.checkedAt}>{new Date(source.checkedAt).toLocaleString()}</time></p> : null}
        {source.retryAt ? <p className="text-xs">{t('contentSources.retryAt')}: <time dateTime={source.retryAt}>{new Date(source.retryAt).toLocaleString()}</time></p> : null}
        {source.error ? <p className="text-xs">{source.error.message}</p> : null}
        {opened === source.sourceId ? <p role="status" className="text-xs">{t('contentSources.loginOpened')}</p> : null}
      </div>
      <div className="flex gap-2">
        {['zhihu', 'bilibili', 'xiaohongshu'].includes(source.sourceId) ? <Button variant="ghost" disabled={busy !== null || !source.enabled} onClick={() => void login(source.sourceId)}>{t('contentSources.openLogin')}</Button> : null}
        <Button variant="ghost" disabled={busy !== null || !source.enabled} onClick={() => void check(source.sourceId)}>{t('contentSources.checkAccess')}</Button>
      </div>
    </div>)}
    {error ? <p role="alert" className="px-5 py-3 text-sm text-[var(--color-danger)]">{error}</p> : null}
  </SettingsSection>;
}
