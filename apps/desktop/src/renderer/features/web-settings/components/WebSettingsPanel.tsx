/*
 * Edits Settings-owned web search provider configuration and its local credential.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsConfiguration } from '@megumi/application/settings/settings-schema';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import {
  localizeRendererError,
  rendererError,
  type RendererErrorDescriptor,
} from '../../../shared/i18n';
import {
  Button,
  SecretInput,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from '../../../shared/ui';

type SearchProvider = NonNullable<SettingsConfiguration['webSearch']['provider']>;
type Status = 'loading' | 'ready' | 'saving' | 'error';

const providers: Array<{ value: SearchProvider; label: string }> = [
  { value: 'brave', label: 'Brave Search' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'exa', label: 'Exa' },
  { value: 'custom', label: '' },
];

export function WebSettingsPanel({ showHeader = true }: { showHeader?: boolean } = {}) {
  const { t } = useTranslation(['settings', 'common']);
  const [saved, setSaved] = useState<SettingsConfiguration['webSearch']>({});
  const [revision, setRevision] = useState('');
  const [credential, setCredential] = useState<
    import('@megumi/application/settings/settings-contracts').CredentialValue
  >({ status: 'missing' });
  const [provider, setProvider] = useState<SearchProvider | ''>('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<RendererErrorDescriptor | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.megumi.settings.readSettings(),
      window.megumi.settings.readCredential({ target: { kind: 'webSearch' } }),
    ])
      .then(([result, credentialResult]) => {
        if (cancelled) return;
        if (!result.ok) throw rendererError(result.data.code, result.data.message);
        if (!credentialResult.ok)
          throw rendererError(credentialResult.data.code, credentialResult.data.message);
        const search = result.data.config.webSearch;
        setRevision(result.data.revision);
        setCredential(credentialResult.data);
        setSaved(search);
        setProvider(search.provider ?? '');
        setBaseUrl(search.baseUrl ?? '');
        setApiKey(credentialResult.data.status === 'found' ? credentialResult.data.value : '');
        setApiKeyDirty(false);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(asRendererError(reason, 'settings_load_failed'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
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
    if (!apiKey.trim() && credential.status !== 'found' && provider === saved.provider) {
      setError(rendererError('web_api_key_required'));
      return;
    }
    setStatus('saving');
    try {
      const result = await window.megumi.settings.updateSettings({
        patch: {
          webSearch: {
            ...(provider !== saved.provider ? { provider } : {}),
            ...(baseUrl !== (saved.baseUrl ?? '') ? { baseUrl: baseUrl.trim() || null } : {}),
          },
        },
        expectedRevision: revision,
      });
      if (!result.ok) throw rendererError(result.data.code, result.data.message);
      setSaved(result.data.settings.config.webSearch);
      setRevision(result.data.settings.revision);
      if (apiKeyDirty && apiKey.trim()) {
        const savedKey = await window.megumi.settings.updateCredential({
          target: { kind: 'webSearch' },
          value: apiKey.trim(),
        });
        if (!savedKey.ok) throw rendererError(savedKey.data.code, savedKey.data.message);
        setCredential({ status: 'found', value: apiKey.trim(), source: 'stored' });
      }
      setApiKey(apiKey.trim());
      setApiKeyDirty(false);
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
      const result = await window.megumi.settings.updateCredential({
        target: { kind: 'webSearch' },
        value: null,
      });
      if (!result.ok) throw rendererError(result.data.code, result.data.message);
      const current = await window.megumi.settings.readCredential({
        target: { kind: 'webSearch' },
      });
      if (!current.ok) throw rendererError(current.data.code, current.data.message);
      setCredential(current.data);
      setApiKey(current.data.status === 'found' ? current.data.value : '');
      setApiKeyDirty(false);
      setStatus('ready');
    } catch (reason) {
      setError(asRendererError(reason, 'settings_update_failed'));
      setStatus('error');
    }
  }

  const busy = status === 'loading' || status === 'saving';
  const fieldClass =
    'h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="space-y-6">
      {showHeader ? (
        <SettingsPageHeader
          title={t('settings:web.title')}
          description={t('settings:web.description')}
        />
      ) : null}
      <form onSubmit={(event) => void save(event)}>
        <SettingsSection
          title={t('settings:web.search')}
          description={t('settings:web.searchDescription')}
        >
          <SettingsRow
            title={t('settings:web.provider')}
            description={t('settings:web.providerDescription')}
          >
            <label className="sr-only" htmlFor="web-search-provider">
              {t('settings:web.provider')}
            </label>
            <select
              id="web-search-provider"
              aria-label={t('settings:web.provider')}
              className={fieldClass}
              value={provider}
              disabled={busy}
              onChange={(event) => setProvider(event.target.value as SearchProvider | '')}
            >
              <option value="">{t('settings:web.selectProvider')}</option>
              {providers.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.value === 'custom' ? t('settings:web.customProvider') : item.label}
                </option>
              ))}
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
              <SecretInput
                ariaLabel={t('settings:web.searchApiKey')}
                showLabel={t('settings:provider.showApiKey')}
                hideLabel={t('settings:provider.hideApiKey')}
                value={apiKey}
                disabled={busy}
                placeholder={t('settings:web.enterApiKey')}
                onChange={(value) => {
                  setApiKey(value);
                  setApiKeyDirty(true);
                }}
                inputClassName={fieldClass}
              />
            </SettingsRow>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              {(credential.status === 'found' ? credential.source : 'missing') === 'stored'
                ? t('settings:web.savedCredential')
                : (credential.status === 'found' ? credential.source : 'missing') === 'environment'
                  ? t('settings:web.environmentCredential', { name: saved.apiKeyEnv ?? '' })
                  : t('settings:web.noCredential')}
            </p>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy || credential.status !== 'found'}
                onClick={() => void clearKey()}
              >
                {t('settings:web.clearKey')}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {status === 'saving' ? t('settings:web.saving') : t('common:actions.save')}
              </Button>
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="border-t border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-5 py-3 text-sm text-[var(--color-danger)]"
            >
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
