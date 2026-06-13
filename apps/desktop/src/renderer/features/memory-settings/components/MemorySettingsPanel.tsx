// Renders the global long-term memory runtime toggle in Settings.
// This component does not display, edit, or preview individual memory records.
import { useEffect, useState } from 'react';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { MemorySettings } from '@megumi/shared/memory';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../../shared/ipc';
import { Button, cx } from '../../../shared/ui';

type MemorySettingsStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

function defaultMemorySettings(): MemorySettings {
  return {
    autoCaptureEnabled: false,
    defaultCandidateReviewMode: 'manual',
    updatedAt: new Date().toISOString(),
  };
}

export function MemorySettingsPanel() {
  const [settings, setSettings] = useState<MemorySettings>(defaultMemorySettings);
  const [status, setStatus] = useState<MemorySettingsStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    void window.megumi.memory.settingsGet(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.settingsGet, {}),
    ).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setStatus('error');
        setError(getRuntimeIpcErrorMessage(result));
        return;
      }
      setSettings(result.data.settings);
      setStatus('ready');
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setStatus('error');
      setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function updateAutoCaptureEnabled(autoCaptureEnabled: boolean): Promise<void> {
    setStatus('saving');
    setError(null);
    const previous = settings;
    const next: MemorySettings = {
      ...settings,
      autoCaptureEnabled,
      updatedAt: new Date().toISOString(),
    };
    setSettings(next);

    let result: Awaited<ReturnType<typeof window.megumi.memory.settingsUpdate>>;
    try {
      result = await window.megumi.memory.settingsUpdate(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.memory.settingsUpdate, next),
      );
    } catch (reason) {
      setSettings(previous);
      setStatus('error');
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (!result.ok) {
      setSettings(previous);
      setStatus('error');
      setError(getRuntimeIpcErrorMessage(result));
      return;
    }
    setSettings(result.data.settings);
    setStatus('ready');
  }

  const enabled = settings.autoCaptureEnabled;
  const busy = status === 'loading' || status === 'saving';

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Long-term memory</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Controls automatic memory capture, Markdown sync, and recall injection across all projects.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Long-term memory"
          aria-checked={enabled}
          disabled={busy}
          onClick={() => void updateAutoCaptureEnabled(!enabled)}
          className={cx(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
            enabled
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
              : 'border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]',
            busy ? 'cursor-wait opacity-70' : 'cursor-pointer',
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              'h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-1',
            )}
          />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
        <p className="text-sm text-[var(--color-text)]">
          {enabled ? 'Memory runtime is enabled.' : 'Memory runtime is paused.'}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void updateAutoCaptureEnabled(!enabled)}
        >
          {enabled ? 'Disable' : 'Enable'}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
      ) : null}
    </section>
  );
}
