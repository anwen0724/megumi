import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from '../shared/theme';
import { AppBody } from '../shell/AppBody';
import { WindowTitleBar } from '../shell/WindowTitleBar';
import { SetupWizard, useSetupWizardStore } from '../features/setup-wizard';
import { ToastViewport } from '../shared/ui';

export default function App() {
  const status = useSetupWizardStore((state) => state.status);
  const setupCompleted = useSetupWizardStore((state) => state.setupCompleted);
  const { t } = useTranslation('common');

  const setupPending = status === 'idle' || status === 'loading';
  const showSetupWizard = !setupPending && setupCompleted !== true;

  return (
    <ThemeProvider>
      <div
        className="flex h-screen min-h-0 flex-col bg-[var(--color-app-bg)] text-[var(--color-text)]"
        style={{
          '--left-sidebar-width': '18rem',
          '--main-content-width': '42rem',
          '--right-sidebar-width': '20rem',
        } as CSSProperties}
      >
        <WindowTitleBar />
        {setupPending ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
            {t('loading.megumi')}
          </div>
        ) : showSetupWizard ? (
          <SetupWizard />
        ) : (
          <AppBody />
        )}
        <ToastViewport />
      </div>
    </ThemeProvider>
  );
}
