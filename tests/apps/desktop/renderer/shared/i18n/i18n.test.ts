// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRendererLanguage,
  initializeRendererI18n,
  rendererI18n,
} from '@megumi/desktop/renderer/shared/i18n';

describe('desktop renderer i18n', () => {
  beforeEach(async () => {
    await initializeRendererI18n('en-US');
  });

  it('switches bundled resources and synchronizes document attributes', async () => {
    expect(rendererI18n.t('actions.retry')).toBe('Retry');

    await applyRendererLanguage('zh-CN');

    expect(rendererI18n.t('actions.retry')).toBe('重试');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('falls back to English for a missing Chinese key', async () => {
    await applyRendererLanguage('zh-CN');

    rendererI18n.addResource('en-US', 'common', 'test.englishOnly', 'English fallback');

    expect(rendererI18n.t('test.englishOnly' as never)).toBe('English fallback');
  });
});
