import { beforeEach, describe, expect, it } from 'vitest';
import {
  initializeRendererI18n,
  localizeRendererError,
  rendererError,
} from '@megumi/desktop/renderer/shared/i18n';

describe('renderer error localization', () => {
  beforeEach(async () => {
    await initializeRendererI18n('en-US');
  });

  it('maps stable codes without exposing the technical message as the summary', () => {
    const error = rendererError('settings_update_failed', 'database locked');

    expect(localizeRendererError(error)).toBe('Settings could not be saved.');
    expect(localizeRendererError(error)).not.toContain('database locked');
    expect(error.technicalMessage).toBe('database locked');
  });

  it('uses a localized generic summary for unknown codes', async () => {
    const error = rendererError('new_unknown_code', 'secret technical detail');

    expect(localizeRendererError(error)).toBe('Something went wrong. Please try again.');

    await initializeRendererI18n('zh-CN');
    expect(localizeRendererError(error)).toBe('出现了问题，请重试。');
  });

  it('uses an action fallback code while retaining the original technical failure', async () => {
    const error = rendererError(
      'config_invalid',
      'C:\\Users\\user\\.megumi\\settings.json is invalid',
      undefined,
      'provider_load_failed',
    );

    expect(localizeRendererError(error)).toBe('Providers could not be loaded.');
    expect(error.technicalMessage).toContain('settings.json');

    await initializeRendererI18n('zh-CN');
    expect(localizeRendererError(error)).toBe('无法加载 Provider。');
  });
});
