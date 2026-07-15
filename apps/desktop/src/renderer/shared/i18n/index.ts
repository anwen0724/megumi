/* Exposes Desktop Renderer localization and formatting capabilities. */
export {
  DEFAULT_RENDERER_LANGUAGE,
  SUPPORTED_RENDERER_LANGUAGES,
  rendererI18n,
} from './i18n';
export {
  applyRendererLanguage,
  getRendererLanguage,
  initializeRendererI18n,
  syncDocumentLanguage,
} from './locale';
export {
  formatDate,
  formatNumber,
  formatRelativeTime,
  formatTime,
  formatTokenCount,
} from './formatting';
export {
  localizeRendererError,
  rendererError,
} from './error-localization';
export type { RendererErrorDescriptor } from './error-localization';
