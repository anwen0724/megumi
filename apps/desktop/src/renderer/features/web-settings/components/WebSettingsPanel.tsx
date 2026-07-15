/*
 * Edits Settings-owned web search provider configuration without exposing stored secrets.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsUiResolved } from '@megumi/product/host-interface';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { localizeRendererError, rendererError, type RendererErrorDescriptor } from '../../../shared/i18n';
import {
  Button,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from '../../../shared/ui';

type SearchProvider = NonNullable<SettingsUiResolved['web']['search']['provider']>;
type Status = 'loading' | 'ready' | 'saving' | 'error';

const providers: Array<{ value: SearchProvider; label: string }> = [
  { value: 'brave', label: 'Brave Search' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'exa', label: 'Exa' },
  { value: 'custom', label: '' },
];

export function WebSettingsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const [saved, setSaved] = useState<SettingsUiResolved['web']['search']>({ hasApiKey: false, credentialSource: 'missing' });
  const [provider, setProvider] = useState<SearchProvider | ''>('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<RendererErrorDescriptor | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.megumi.settings.get(createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}))
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) throw rendererError(result.data.code, result.data.message);
        if (result.data.status === 'failed') throw rendererError(result.data.failure.code, result.data.failure.message);
        const search = result.data.settings.web.search;
        setSaved(search);
        setProvider(search.provider ?? '');
        setBaseUrl(search.baseUrl ?? '');
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(asRendererError(reason, 'settings_load_failed'));
          setStatus('error');
        }
      });
    return () => { cancelled = true; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!provider) {
      setError(rendererError('web_provider_required'));
      return;
    }
    if (provider === 'custom' && !baseUrl.trim()) {
      setError(rendererError('web_base_url_required'));
      return;
    }
    if (!apiKey.trim() && !saved.hasApiKey && provider === saved.provider) {
      setError(rendererError('web_api_key_required'));
      return;
    }
    setStatus('saving');
    try {
      const result = await window.megumi.settings.update(createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, {
        web: {
          search: {
            provider,
            baseUrl: provider === 'custom' ? baseUrl.trim() : null,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : provider !== saved.provider ? { apiKey: null } : {}),
          },
        },
      }));
      if (!result.ok) throw rendererError(result.data.code, result.data.message);
      if (result.data.status === 'failed') throw rendererError(result.data.failure.code, result.data.failure.message);
      const search = result.data.settings.web.search;
      setSaved(search);
      setProvider(search.provider ?? '');
      setBaseUrl(search.baseUrl ?? '');
      setApiKey('');
      setStatus('ready');
    } catch (reason) {
      setError(asRendererError(reason, 'settings_update_failed'));
      setStatus('error');
    }
  }

  async function clearKey() {
    setStatus('saving');
    setError(null);
    try {
      const result = await window.megumi.settings.update(createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, {
        web: { search: { apiKey: null } },
      }));
      if (!result.ok) throw rendererError(result.data.code, result.data.message);
      if (result.data.status === 'failed') throw rendererError(result.data.failure.code, result.data.failure.message);
      setSaved(result.data.settings.web.search);
      setApiKey('');
      setStatus('ready');
    } catch (reason) {
      setError(asRendererError(reason, 'settings_update_failed'));
      setStatus('error');
    }
  }

  const busy = status === 'loading' || status === 'saving';
  const fieldClass = 'h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('settings:web.title')}
        description={t('settings:web.description')}
      />
      <form onSubmit={(event) => void save(event)}>
        <SettingsSection
          title={t('settings:web.search')}
          description={t('settings:web.searchDescription')}
        >
          <SettingsRow
            title={t('settings:web.provider')}
            description={t('settings:web.providerDescription')}
          >
            <label className="sr-only" htmlFor="web-search-provider">{t('settings:web.provider')}</label>
          <select
            id="web-search-provider"
            aria-label={t('settings:web.provider')}
            className={fieldClass}
            value={provider}
            disabled={busy}
            onChange={(event) => setProvider(event.target.value as SearchProvider | '')}
          >
            <option value="">{t('settings:web.selectProvider')}</option>
            {providers.map((item) => <option key={item.value} value={item.value}>{item.value === 'custom' ? t('settings:web.customProvider') : item.label}</option>)}
          </select>
          </SettingsRow>

          {provider === 'custom' ? (
            <div className="border-t border-[var(--color-border)]">
              <SettingsRow
                title={t('settings:web.baseUrl')}
                description={t('settings:web.baseUrlDescription')}
              >
                <input
                  aria-label={t('settings:web.searchBaseUrl')}
                  className={fieldClass}
                  value={baseUrl}
                  disabled={busy}
                  placeholder="https://search.example.com/search"
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </SettingsRow>
            </div>
          ) : null}

          <div className="border-t border-[var(--color-border)]">
            <SettingsRow
              title={t('settings:web.apiKey')}
              description={t('settings:web.apiKeyDescription')}
            >
              <input
                aria-label={t('settings:web.searchApiKey')}
                type="password"
                className={fieldClass}
                value={apiKey}
                disabled={busy}
                placeholder={saved.hasApiKey ? t('settings:web.configuredCredential') : t('settings:web.enterApiKey')}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </SettingsRow>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              {saved.credentialSource === 'settings' ? t('settings:web.savedCredential')
                : saved.credentialSource === 'environment' ? t('settings:web.environmentCredential', { name: saved.apiKeyEnv ?? '' })
                  : t('settings:web.noCredential')}
            </p>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" disabled={busy || !saved.hasApiKey} onClick={() => void clearKey()}>
                {t('settings:web.clearKey')}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {status === 'saving' ? t('settings:web.saving') : t('common:actions.save')}
              </Button>
            </div>
          </div>

          {error ? (
            <p role="alert" className="border-t border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-5 py-3 text-sm text-[var(--color-danger)]">
              {localizeRendererError(error)}
            </p>
          ) : null}
        </SettingsSection>
      </form>
    </div>
  );
}

function asRendererError(reason: unknown, fallbackCode: string): RendererErrorDescriptor {
  if (typeof reason === 'object' && reason !== null && 'code' in reason) {
    return reason as RendererErrorDescriptor;
  }
  return rendererError(fallbackCode, reason instanceof Error ? reason.message : String(reason));
}
