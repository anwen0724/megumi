/* Projects a resolved Settings language into i18next and HTML attributes. */
import type { AppLanguage } from '@megumi/product/host-interface';
import {
  DEFAULT_RENDERER_LANGUAGE,
  ensureRendererI18n,
  rendererI18n,
} from './i18n';

export async function initializeRendererI18n(language: AppLanguage): Promise<void> {
  await ensureRendererI18n(language);
  syncDocumentLanguage(language);
}

export async function applyRendererLanguage(language: AppLanguage): Promise<void> {
  await initializeRendererI18n(language);
}

export function getRendererLanguage(): AppLanguage {
  const language = rendererI18n.resolvedLanguage;
  return language === 'zh-CN' || language === 'en-US'
    ? language
    : DEFAULT_RENDERER_LANGUAGE;
}

export function syncDocumentLanguage(language: AppLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = rendererI18n.dir(language);
}
