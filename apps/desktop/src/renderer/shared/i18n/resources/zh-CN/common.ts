/* Defines Simplified Chinese copy shared across Desktop Renderer features. */
import type { TranslationShape } from '../translation-shape';
import type { common as source } from '../en-US/common';

export const common = {
  actions: {
    back: '返回',
    cancel: '取消',
    close: '关闭',
    continue: '继续',
    current: '当前',
    retry: '重试',
    save: '保存',
    open: '打开',
    remove: '移除',
    dismiss: '忽略',
  },
  loading: {
    megumi: '正在加载 Megumi…',
  },
  notifications: {
    label: '通知',
    dismiss: '关闭通知',
  },
  language: {
    label: '语言',
    english: 'English',
    englishDetail: 'English（美国）',
    chinese: '简体中文',
    chineseDetail: '简体中文（中国大陆）',
  },
  theme: {
    label: '主题',
    current: '{{theme}}，当前主题',
    names: {
      'megumi-warm': 'Megumi 暖色',
      'neutral-light': '中性浅色',
      'sunlit-sky': '绀云晴川',
      'rose-moon': '玫瑰月白',
      'verdant-cloud': '青岚云腴',
      'cangming-blue': '沧溟玉轴',
      'frost-cyan': '霜纨岫烟',
      'cyan-tide': '青蓝沧浪',
      'midnight-blue': '午夜蓝',
    },
  },
} as const satisfies TranslationShape<typeof source>;
