/* Defines Simplified Chinese summaries for stable Renderer error codes. */
import type { TranslationShape } from '../translation-shape';
import type { errors as source } from '../en-US/errors';

export const errors = {
  generic: '出现了问题，请重试。',
  settings_update_failed: '无法保存设置。',
  settings_load_failed: '无法加载设置。',
  setup_incomplete: '无法保存设置完成状态。',
  render_failed: '部分内容无法显示。',
  app_render_failed: '出现了问题。',
  web_provider_required: '请选择搜索 Provider。',
  web_base_url_required: '自定义搜索需要 Base URL。',
  web_api_key_required: '请输入 API key 或配置 Provider 环境变量。',
} as const satisfies TranslationShape<typeof source>;
