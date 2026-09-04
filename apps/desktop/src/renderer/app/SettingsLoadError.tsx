/* Shows safe Settings diagnostics and Desktop-owned recovery actions without opening setup. */
import { useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSetupWizardStore } from '../features/setup-wizard';
import { Button } from '../shared/ui';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../shared/ipc';

/** Keeps failed bootstrap separate from first-run configuration and preserves the file for correction. */
export function SettingsLoadError() {
  const { t } = useTranslation('common');
  const issues = useSetupWizardStore((state) => state.loadIssues);
  const [settingsPath, setSettingsPath] = useState<string>();
  const [pending, setPending] = useState(false);
  const [operationFailed, setOperationFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await window.megumi.settingsRecovery.get(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.settingsRecovery.get, {}),
        );
        if (!active) return;
        if (result.ok) setSettingsPath(result.data.settingsPath);
        else setOperationFailed(true);
      } catch { if (active) setOperationFailed(true); }
    })();
    return () => { active = false; };
  }, []);

  async function recover(action: 'openDirectory' | 'restart'): Promise<void> {
    setPending(true);
    setOperationFailed(false);
    try {
      const result = action === 'openDirectory'
        ? await window.megumi.settingsRecovery.openDirectory(createRendererRuntimeIpcRequest(IPC_CHANNELS.settingsRecovery.openDirectory, {}))
        : await window.megumi.settingsRecovery.restart(createRendererRuntimeIpcRequest(IPC_CHANNELS.settingsRecovery.restart, {}));
      if (!result.ok) setOperationFailed(true);
    } catch { setOperationFailed(true); }
    finally { setPending(false); }
  }

  return (
    <main className="flex min-h-0 flex-1 items-start justify-center overflow-auto px-6 py-12 sm:items-center" data-testid="settings-load-error">
      <section className="w-full max-w-xl space-y-6" aria-labelledby="settings-load-error-title">
        <header className="space-y-3">
          <AlertTriangle size={28} className="text-[var(--color-danger)]" aria-hidden="true" />
          <h1 id="settings-load-error-title" className="text-2xl font-semibold">{t('settingsRecovery.title')}</h1>
          <p className="text-sm leading-6 text-[var(--color-text-muted)]">{t('settingsRecovery.description')}</p>
        </header>
        <div role="alert" className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
          {issues.length > 0 ? <ul className="space-y-3">{issues.map((issue, index) => (
            <li key={`${issue.path}:${index}`}><code className="break-all font-medium">{issue.path}</code><p>{issue.message}</p></li>
          ))}</ul> : <p>{t('settingsRecovery.genericReason')}</p>}
          <p className="text-xs text-[var(--color-text-muted)]">{t('settingsRecovery.location')}</p>
          <code className="block select-text break-all">{settingsPath ?? t('settingsRecovery.locationUnavailable')}</code>
        </div>
        {operationFailed && <p role="alert" className="text-sm text-[var(--color-danger)]">{t('settingsRecovery.operationFailed')}</p>}
        <div className="flex flex-wrap gap-3">
          <Button disabled={pending} onClick={() => void recover('openDirectory')}><FolderOpen size={16} />{t('settingsRecovery.openDirectory')}</Button>
          <Button variant="primary" disabled={pending} onClick={() => void recover('restart')}><RotateCw size={16} />{t('settingsRecovery.restart')}</Button>
        </div>
      </section>
    </main>
  );
}
