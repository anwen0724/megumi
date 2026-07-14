// Renders the global long-term memory runtime toggle in Settings.
// This component does not display, edit, or preview individual memory records.
import { useEffect, useState } from 'react';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../../shared/ipc';
import {
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  cx,
} from '../../../shared/ui';

type MemorySettingsStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

export function MemorySettingsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<MemorySettingsStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    void window.megumi.settings.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
    ).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setStatus('error');
        setError(getRuntimeIpcErrorMessage(result));
        return;
      }
      if (result.data.status === 'failed') {
        setStatus('error');
        setError(result.data.failure.message);
        return;
      }
      setEnabled(result.data.settings.memory.enabled);
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
    const previous = enabled;
    setEnabled(autoCaptureEnabled);

    let result: Awaited<ReturnType<typeof window.megumi.settings.update>>;
    try {
      result = await window.megumi.settings.update(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, {
          memory: {
            enabled: autoCaptureEnabled,
          },
        }),
      );
    } catch (reason) {
      setEnabled(previous);
      setStatus('error');
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (!result.ok) {
      setEnabled(previous);
      setStatus('error');
      setError(getRuntimeIpcErrorMessage(result));
      return;
    }
    if (result.data.status === 'failed') {
      setEnabled(previous);
      setStatus('error');
      setError(result.data.failure.message);
      return;
    }
    setEnabled(result.data.settings.memory.enabled);
    setStatus('ready');
  }

  const busy = status === 'loading' || status === 'saving';

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Memory"
        description="Control whether Megumi may remember useful information across conversations."
      />
      <SettingsSection title="Memory preferences">
        <SettingsRow
          title="Conversation memory"
          description="Remember useful project context and preferences so future conversations can continue with less repetition."
        >
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-[var(--color-text-muted)]">
              {status === 'loading' ? 'Loading…' : enabled ? 'On' : 'Off'}
            </span>
            <button
              type="button"
              role="switch"
              aria-label="Conversation memory"
              aria-checked={enabled}
              disabled={busy}
              onClick={() => void updateAutoCaptureEnabled(!enabled)}
              className={cx(
                'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
                enabled
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                  : 'border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]',
                busy ? 'cursor-wait opacity-60' : undefined,
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150',
                  enabled ? 'translate-x-6' : 'translate-x-1',
                )}
              />
            </button>
          </div>
        </SettingsRow>
        {error ? (
          <p role="alert" className="border-t border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-5 py-3 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
      </SettingsSection>
    </div>
  );
}
