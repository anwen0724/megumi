/* Defines Simplified Chinese summaries for stable Renderer error codes. */
import type { TranslationShape } from '../translation-shape';
import type { errors as source } from '../en-US/errors';

export const errors = {
  generic: '出现了问题，请重试。',
  settings_update_failed: '无法保存设置。',
  settings_load_failed: '无法加载设置。',
  setup_incomplete: '无法保存设置完成状态。',
} as const satisfies TranslationShape<typeof source>;
