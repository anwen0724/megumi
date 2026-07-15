/*
 * Coordinates the single resolved-settings read used to initialize Renderer projections.
 * Locale, theme, and setup state are ready before React performs its first render.
 */
import type { ReactNode } from 'react';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../shared/ipc';
import { initializeRendererI18n, rendererError } from '../shared/i18n';
import { useThemeStore } from '../shared/theme';
import { useSetupWizardStore } from '../features/setup-wizard';
import App from './App';
import ErrorBoundary from './error-boundary';

interface RendererRoot {
  render(children: ReactNode): void;
}

export async function bootstrapRenderer(root: RendererRoot): Promise<void> {
  try {
    const result = await window.megumi.settings.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
    );

    if (!result.ok) {
      await applyBootstrapFailure(result.data.message);
    } else if (result.data.status === 'failed') {
      await applyBootstrapFailure(result.data.failure.message);
    } else {
      const { language, theme, setup } = result.data.settings;
      await initializeLocaleWithFallback(language);
      useThemeStore.getState().applyBootstrapTheme(theme);
      useSetupWizardStore.getState().applyBootstrapSettings({
        language,
        setupCompleted: setup.completed,
      });
    }
  } catch (error) {
    await applyBootstrapFailure(error instanceof Error ? error.message : undefined);
  }

  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

async function initializeLocaleWithFallback(language: 'zh-CN' | 'en-US'): Promise<void> {
  try {
    await initializeRendererI18n(language);
  } catch {
    console.error('[renderer:i18n] Locale initialization failed; using bundled fallback.');
    await initializeRendererI18n('en-US');
  }
}

async function applyBootstrapFailure(technicalMessage?: string): Promise<void> {
  await initializeLocaleWithFallback('en-US');
  useSetupWizardStore.getState().applyBootstrapFailure(
    rendererError('settings_load_failed', technicalMessage),
  );
}
