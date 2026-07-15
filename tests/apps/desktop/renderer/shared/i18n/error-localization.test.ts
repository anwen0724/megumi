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
});
