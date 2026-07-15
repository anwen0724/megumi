/* Defines Simplified Chinese copy for Desktop settings features. */
import type { TranslationShape } from '../translation-shape';
import type { settings as source } from '../en-US/settings';

export const settings = {
  appearance: {
    languageTitle: '语言',
    languageDescription: '选择桌面界面使用的语言。',
    themeTitle: '主题',
    themeDescription: '选择桌面界面的配色主题。',
  },
} as const satisfies TranslationShape<typeof source>;
