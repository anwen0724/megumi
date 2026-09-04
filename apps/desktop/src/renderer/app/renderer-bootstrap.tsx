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
import ErrorBoundary from './error-boundary';
import { usePermissionModeStore } from '../entities/permission-mode';
import { useModelSelectionStore } from '../entities/model-selection';

interface RendererRoot {
  render(children: ReactNode): void;
}

export async function bootstrapRenderer(root: RendererRoot): Promise<void> {
  const isCharacterWindow = new URLSearchParams(window.location.search).get('megumiWindowRole') === 'character';
  if (isCharacterWindow) document.documentElement.classList.add('megumi-character-window');
  const surfacePromise = isCharacterWindow ? import('./CharacterApp') : import('./App');

  try {
    const result = await window.megumi.settings.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
    );

    if (!result.ok) {
      await applyBootstrapFailure();
    } else if (result.data.status === 'failed') {
      await applyBootstrapFailure(result.data.issues);
    } else {
      const { language, theme, setup, permissions, modelSelection } = result.data.settings;
      await initializeLocaleWithFallback(language);
      useThemeStore.getState().applyBootstrapTheme(theme);
      usePermissionModeStore.getState().applyBootstrapMode(permissions.mode);
      useModelSelectionStore.getState().applyBootstrapSelection(modelSelection);
      useSetupWizardStore.getState().applyBootstrapSettings({
        language,
        setupCompleted: setup.completed,
      });
    }
  } catch {
    await applyBootstrapFailure();
  }

  // Character controls must not bypass a failed configuration bootstrap either.
  const Surface = useSetupWizardStore.getState().status === 'load-error'
    ? (await import('./App')).default : (await surfacePromise).default;
  root.render(
    <ErrorBoundary>
      <Surface />
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

async function applyBootstrapFailure(issues?: { path: string; message: string }[]): Promise<void> {
  await initializeLocaleWithFallback(navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US');
  useSetupWizardStore.getState().applyBootstrapFailure(
    rendererError('settings_load_failed'), issues,
  );
}
