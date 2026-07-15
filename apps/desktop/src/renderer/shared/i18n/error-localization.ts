/* Maps stable Renderer error descriptors to localized user summaries. */
import { rendererI18n } from './i18n';

export interface RendererErrorDescriptor {
  code: string;
  technicalMessage?: string;
  details?: Record<string, unknown>;
  fallbackCode?: string;
}

export function rendererError(
  code: string,
  technicalMessage?: string,
  details?: Record<string, unknown>,
  fallbackCode?: string,
): RendererErrorDescriptor {
  return {
    code,
    ...(technicalMessage ? { technicalMessage } : {}),
    ...(details ? { details } : {}),
    ...(fallbackCode ? { fallbackCode } : {}),
  };
}

export function localizeRendererError(error: RendererErrorDescriptor): string {
  const candidate = `errors:${error.code}`;
  if (rendererI18n.exists(candidate)) {
    return rendererI18n.t(candidate as never);
  }
  if (error.fallbackCode) {
    const fallback = `errors:${error.fallbackCode}`;
    if (rendererI18n.exists(fallback)) return rendererI18n.t(fallback as never);
  }
  return rendererI18n.t('errors:generic');
}
