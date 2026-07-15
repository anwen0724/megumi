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
  provider_load_failed: '无法加载 Provider。',
  provider_update_failed: '无法保存 Provider。',
  provider_delete_failed: '无法移除 Provider。',
  provider_api_key_update_failed: '无法保存 API key。',
  provider_api_key_delete_failed: '无法移除 API key。',
  project_load_failed: '无法加载项目。',
  project_use_failed: '无法添加项目。',
  project_open_failed: '无法打开项目。',
  project_not_found: '未找到该项目。',
  project_remove_failed: '无法移除项目。',
  project_remove_blocked: '仍有产品数据引用该项目，暂时无法移除。',
  workspace_files_list_failed: '无法列出工作区文件。',
  workspace_not_found: '未找到工作区。',
  workspace_path_rejected: '工作区路径已被拒绝。',
} as const satisfies TranslationShape<typeof source>;
