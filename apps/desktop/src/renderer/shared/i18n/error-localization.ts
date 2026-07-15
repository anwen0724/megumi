/* Maps stable Renderer error descriptors to localized user summaries. */
import { rendererI18n } from './i18n';

export interface RendererErrorDescriptor {
  code: string;
  technicalMessage?: string;
  details?: Record<string, unknown>;
}

export function rendererError(
  code: string,
  technicalMessage?: string,
  details?: Record<string, unknown>,
): RendererErrorDescriptor {
  return {
    code,
    ...(technicalMessage ? { technicalMessage } : {}),
    ...(details ? { details } : {}),
  };
}

export function localizeRendererError(error: RendererErrorDescriptor): string {
  const candidate = `errors:${error.code}`;
  if (rendererI18n.exists(candidate)) {
    return rendererI18n.t(candidate as never);
  }
  return rendererI18n.t('errors:generic');
}
