/* Defines Simplified Chinese copy for first-run setup. */
import type { TranslationShape } from '../translation-shape';
import type { setup as source } from '../en-US/setup';

export const setup = {
  branding: {
    subtitle: '首次设置',
    privacy: 'Provider 凭据和偏好设置仅保存在此设备上。',
  },
  progressLabel: '设置进度',
  steps: {
    preferences: { label: '外观', description: '语言和主题' },
    provider: { label: 'Provider', description: '连接 AI 模型' },
    ready: { label: '准备就绪', description: '检查并开始' },
  },
  preferences: {
    eyebrow: '欢迎',
    title: '定制你的 Megumi',
    description: '选择 Megumi 的界面语言和外观。稍后可以在设置中修改。',
    languageHint: '选择界面使用的语言。',
    appearance: '外观',
  },
  provider: {
    eyebrow: 'AI Provider',
    title: '连接你的模型',
    description: '选择支持的 Provider 并输入 API key。Megumi 将使用目录中的默认连接配置。',
    label: 'Provider',
    loading: '正在加载支持的 Provider…',
    modelCount_one: '{{count}} 个可用模型',
    modelCount_other: '{{count}} 个可用模型',
    defaultModel: '默认模型',
    apiKey: 'API key',
    apiKeyPlaceholder: '输入 API key',
    showApiKey: '显示 API key',
    hideApiKey: '隐藏 API key',
    advanced: '高级设置',
    baseUrl: 'Base URL',
    protocol: '协议：{{protocol}}',
  },
  ready: {
    eyebrow: '全部就绪',
    title: '可以开始构建了',
    description: '检查当前设置，然后进入 Megumi。这些设置之后仍可在设置页面修改。',
    setupComplete: '设置完成',
    changeLater: '所有选项之后都可以修改。',
    provider: 'Provider',
    defaultModel: '默认模型',
    notConfigured: '未配置',
    configureLater: '稍后在设置中配置',
  },
  actions: {
    setupLater: '稍后设置',
    saving: '正在保存…',
    start: '开始使用 Megumi',
  },
} as const satisfies TranslationShape<typeof source>;
