/* Owns the single bundled i18next runtime used by the Desktop Renderer. */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { AppLanguage } from '@megumi/product/host-interface';
import { resources } from './resources';

export const DEFAULT_RENDERER_LANGUAGE: AppLanguage = 'en-US';
export const SUPPORTED_RENDERER_LANGUAGES = ['zh-CN', 'en-US'] as const satisfies readonly AppLanguage[];
export const rendererI18n = i18next.createInstance();

let initialization: Promise<unknown> | null = null;

export async function ensureRendererI18n(language: AppLanguage): Promise<void> {
  if (!initialization) {
    initialization = rendererI18n
      .use(initReactI18next)
      .init({
        resources,
        lng: language,
        supportedLngs: SUPPORTED_RENDERER_LANGUAGES,
        fallbackLng: DEFAULT_RENDERER_LANGUAGE,
        defaultNS: 'common',
        ns: ['common', 'setup', 'shell', 'settings', 'chat', 'errors'],
        returnNull: false,
        debug: false,
        saveMissing: false,
        initAsync: false,
        react: { useSuspense: false },
        interpolation: { escapeValue: false },
      });
    await initialization;
    return;
  }

  await initialization;
  if (rendererI18n.resolvedLanguage !== language) {
    await rendererI18n.changeLanguage(language);
  }
}
