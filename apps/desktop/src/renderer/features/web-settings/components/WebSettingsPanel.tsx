/*
 * Edits Settings-owned web search provider configuration without exposing stored secrets.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { SettingsUiResolved } from '@megumi/product/host-interface';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../../shared/ipc';
import { Button } from '../../../shared/ui';

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
  const fieldClass = 'mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]';

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-4">
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Web search</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Choose a search API. Megumi does not select or bundle a default search provider.
        </p>

        <label className="mt-4 block text-sm text-[var(--color-text)]">
          Search provider
          <select
            aria-label="Search provider"
            className={fieldClass}
            value={provider}
            disabled={busy}
            onChange={(event) => setProvider(event.target.value as SearchProvider | '')}
          >
            <option value="">Select provider</option>
            {providers.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>

        {provider === 'custom' ? (
          <label className="mt-4 block text-sm text-[var(--color-text)]">
            Base URL
            <input aria-label="Search Base URL" className={fieldClass} value={baseUrl} disabled={busy}
              placeholder="https://search.example.com/search" onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
        ) : null}

        <label className="mt-4 block text-sm text-[var(--color-text)]">
          API key
          <input aria-label="Search API key" type="password" className={fieldClass} value={apiKey} disabled={busy}
            placeholder={saved.hasApiKey ? 'A credential is already configured' : 'Enter API key'}
            onChange={(event) => setApiKey(event.target.value)} />
        </label>

        <div className="mt-3 text-sm text-[var(--color-text-muted)]">
          Credential: {saved.credentialSource === 'settings' ? 'Settings key active'
            : saved.credentialSource === 'environment' ? `Environment key active${saved.apiKeyEnv ? ` (${saved.apiKeyEnv})` : ''}`
              : 'Missing key'}
        </div>

        {error ? <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
          <Button type="button" variant="ghost" disabled={busy || !saved.hasApiKey} onClick={() => void clearKey()}>
            Clear key
          </Button>
          <Button type="submit" disabled={busy}>{status === 'saving' ? 'Saving…' : 'Save'}</Button>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Web page reading</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          web_fetch is available without a search API and only reads public HTTP(S) pages through network safety checks.
        </p>
      </section>
    </form>
  );
}
