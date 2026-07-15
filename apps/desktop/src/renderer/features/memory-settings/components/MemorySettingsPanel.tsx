// Renders the global long-term memory runtime toggle in Settings.
// This component does not display, edit, or preview individual memory records.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { localizeRendererError, rendererError, type RendererErrorDescriptor } from '../../../shared/i18n';
import {
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  cx,
} from '../../../shared/ui';

type MemorySettingsStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

export function MemorySettingsPanel() {
  const { t } = useTranslation('settings');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<MemorySettingsStatus>('idle');
  const [error, setError] = useState<RendererErrorDescriptor | null>(null);

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
        setError(rendererError(result.data.code, result.data.message));
        return;
      }
      if (result.data.status === 'failed') {
        setStatus('error');
        setError(rendererError(result.data.failure.code, result.data.failure.message));
        return;
      }
      setEnabled(result.data.settings.memory.enabled);
      setStatus('ready');
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setStatus('error');
      setError(rendererError('settings_load_failed', reason instanceof Error ? reason.message : String(reason)));
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
      setError(rendererError('settings_update_failed', reason instanceof Error ? reason.message : String(reason)));
      return;
    }
    if (!result.ok) {
      setEnabled(previous);
      setStatus('error');
      setError(rendererError(result.data.code, result.data.message));
      return;
    }
    if (result.data.status === 'failed') {
      setEnabled(previous);
      setStatus('error');
      setError(rendererError(result.data.failure.code, result.data.failure.message));
      return;
    }
    setEnabled(result.data.settings.memory.enabled);
    setStatus('ready');
  }

  const busy = status === 'loading' || status === 'saving';

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('memory.title')}
        description={t('memory.description')}
      />
      <SettingsSection title={t('memory.preferences')}>
        <SettingsRow
          title={t('memory.conversation')}
          description={t('memory.conversationDescription')}
        >
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-[var(--color-text-muted)]">
              {status === 'loading' ? t('memory.loading') : enabled ? t('memory.on') : t('memory.off')}
            </span>
            <button
              type="button"
              role="switch"
              aria-label={t('memory.conversation')}
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
            {localizeRendererError(error)}
          </p>
        ) : null}
      </SettingsSection>
    </div>
  );
}
