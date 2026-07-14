/*
 * Edits Settings-owned web search provider configuration without exposing stored secrets.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { SettingsUiResolved } from '@megumi/product/host-interface';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../../shared/ipc';
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
  { value: 'custom', label: 'Custom (Megumi protocol)' },
];

export function WebSettingsPanel() {
  const [saved, setSaved] = useState<SettingsUiResolved['web']['search']>({ hasApiKey: false, credentialSource: 'missing' });
  const [provider, setProvider] = useState<SearchProvider | ''>('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.megumi.settings.get(createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}))
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) throw new Error(getRuntimeIpcErrorMessage(result));
        if (result.data.status === 'failed') throw new Error(result.data.failure.message);
        const search = result.data.settings.web.search;
        setSaved(search);
        setProvider(search.provider ?? '');
        setBaseUrl(search.baseUrl ?? '');
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setStatus('error');
        }
      });
    return () => { cancelled = true; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!provider) {
      setError('Select a search provider.');
      return;
    }
    if (provider === 'custom' && !baseUrl.trim()) {
      setError('Custom search requires a Base URL.');
      return;
    }
    if (!apiKey.trim() && !saved.hasApiKey && provider === saved.provider) {
      setError('Enter an API key or configure the provider environment variable.');
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
      if (!result.ok) throw new Error(getRuntimeIpcErrorMessage(result));
      if (result.data.status === 'failed') throw new Error(result.data.failure.message);
      const search = result.data.settings.web.search;
      setSaved(search);
      setProvider(search.provider ?? '');
      setBaseUrl(search.baseUrl ?? '');
      setApiKey('');
      setStatus('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
      if (!result.ok) throw new Error(getRuntimeIpcErrorMessage(result));
      if (result.data.status === 'failed') throw new Error(result.data.failure.message);
      setSaved(result.data.settings.web.search);
      setApiKey('');
      setStatus('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('error');
    }
  }

  const busy = status === 'loading' || status === 'saving';
  const fieldClass = 'h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Web Access"
        description="Choose the search service Megumi can use when it needs current information."
      />
      <form onSubmit={(event) => void save(event)}>
        <SettingsSection
          title="Search"
          description="Megumi does not select or bundle a default search provider."
        >
          <SettingsRow
            title="Search provider"
            description="Choose the service used by the web_search tool."
          >
            <label className="sr-only" htmlFor="web-search-provider">Search provider</label>
          <select
            id="web-search-provider"
            aria-label="Search provider"
            className={fieldClass}
            value={provider}
            disabled={busy}
            onChange={(event) => setProvider(event.target.value as SearchProvider | '')}
          >
            <option value="">Select provider</option>
            {providers.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          </SettingsRow>

          {provider === 'custom' ? (
            <div className="border-t border-[var(--color-border)]">
              <SettingsRow
                title="Base URL"
                description="Enter the endpoint for a custom search service."
              >
                <input
                  aria-label="Search Base URL"
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
              title="API key"
              description="Stored securely on this device after saving."
            >
              <input
                aria-label="Search API key"
                type="password"
                className={fieldClass}
                value={apiKey}
                disabled={busy}
                placeholder={saved.hasApiKey ? 'A credential is already configured' : 'Enter API key'}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </SettingsRow>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              {saved.credentialSource === 'settings' ? 'API key saved securely on this device'
                : saved.credentialSource === 'environment' ? `Using environment variable${saved.apiKeyEnv ? ` ${saved.apiKeyEnv}` : ''}`
                  : 'No API key configured'}
            </p>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" disabled={busy || !saved.hasApiKey} onClick={() => void clearKey()}>
                Clear key
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {status === 'saving' ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>

          {error ? (
            <p role="alert" className="border-t border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-5 py-3 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
        </SettingsSection>
      </form>
    </div>
  );
}
