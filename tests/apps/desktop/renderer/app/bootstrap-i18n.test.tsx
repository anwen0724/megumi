// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapRenderer } from '@megumi/desktop/renderer/app/renderer-bootstrap';
import { rendererI18n } from '@megumi/desktop/renderer/shared/i18n';
import { useThemeStore } from '@megumi/desktop/renderer/shared/theme';
import { useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';
import { usePermissionModeStore } from '@megumi/desktop/renderer/entities/permission-mode';
import { useModelSelectionStore } from '@megumi/desktop/renderer/entities/model-selection';

function successfulSettings(language: 'zh-CN' | 'en-US', setupCompleted = true) {
  return {
    ok: true as const,
    data: {
      status: 'ok' as const,
      settings: {
        language,
        theme: 'sage-mist' as const,
        setup: { completed: setupCompleted },
        permissions: { mode: 'ask' as const, allow: [], ask: [], deny: [] },
        memory: { enabled: false },
        modelSelection: { providerId: 'deepseek', modelId: 'deepseek-v4-pro' },
        web: { search: { enabled: false, providerId: 'tavily', maxResults: 5, timeoutMs: 10_000 } },
        providers: {},
      },
    },
    meta: {},
  };
}

function installSettingsGet(get: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: { settings: { get } },
  });
}

describe('renderer bootstrap localization', () => {
  beforeEach(() => {
    useThemeStore.setState(useThemeStore.getInitialState(), true);
    useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
    usePermissionModeStore.setState(usePermissionModeStore.getInitialState(), true);
    useModelSelectionStore.setState(useModelSelectionStore.getInitialState(), true);
  });

  it('projects one resolved settings snapshot before the first render', async () => {
    const get = vi.fn().mockResolvedValue(successfulSettings('zh-CN', false));
    const render = vi.fn(() => {
      expect(rendererI18n.resolvedLanguage).toBe('zh-CN');
      expect(document.documentElement.lang).toBe('zh-CN');
      expect(useThemeStore.getState().theme).toBe('sage-mist');
      expect(usePermissionModeStore.getState().mode).toBe('ask');
      expect(useModelSelectionStore.getState().selection).toEqual({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
      });
      expect(useSetupWizardStore.getState()).toMatchObject({
        status: 'ready',
        language: 'zh-CN',
        setupCompleted: false,
      });
    });
    installSettingsGet(get);

    await bootstrapRenderer({ render });

    expect(get).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does not render while the settings snapshot is unresolved', async () => {
    let resolveSettings!: (value: ReturnType<typeof successfulSettings>) => void;
    const get = vi.fn(() => new Promise((resolve) => { resolveSettings = resolve; }));
    const render = vi.fn();
    installSettingsGet(get);

    const bootstrap = bootstrapRenderer({ render });
    expect(render).not.toHaveBeenCalled();

    resolveSettings(successfulSettings('en-US'));
    await bootstrap;

    expect(render).toHaveBeenCalledTimes(1);
    expect(rendererI18n.resolvedLanguage).toBe('en-US');
  });

  it('renders a recoverable fallback when settings loading fails', async () => {
    const get = vi.fn().mockResolvedValue({
      ok: false,
      data: { code: 'settings_transport_failed', message: 'private transport detail' },
      meta: {},
    });
    const render = vi.fn();
    installSettingsGet(get);

    await expect(bootstrapRenderer({ render })).resolves.toBeUndefined();

    expect(rendererI18n.resolvedLanguage).toBe('en-US');
    expect(useThemeStore.getState().theme).toBe('midnight-blue');
    expect(useSetupWizardStore.getState()).toMatchObject({
      status: 'error',
      setupCompleted: false,
      error: {
        code: 'settings_load_failed',
        technicalMessage: 'private transport detail',
      },
    });
    expect(render).toHaveBeenCalledTimes(1);
  });
});
