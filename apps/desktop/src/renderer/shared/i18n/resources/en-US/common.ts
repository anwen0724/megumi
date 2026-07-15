/* Defines source-language copy shared across Desktop Renderer features. */
export const common = {
  actions: {
    back: 'Back',
    cancel: 'Cancel',
    close: 'Close',
    continue: 'Continue',
    current: 'Current',
    retry: 'Retry',
    save: 'Save',
    open: 'Open',
    remove: 'Remove',
    dismiss: 'Dismiss',
  },
  loading: {
    megumi: 'Loading Megumi…',
  },
  notifications: {
    label: 'Notifications',
    dismiss: 'Dismiss notification',
  },
  language: {
    label: 'Language',
    english: 'English',
    englishDetail: 'English (United States)',
    chinese: '简体中文',
    chineseDetail: '简体中文（中国大陆）',
  },
  theme: {
    label: 'Theme',
    current: '{{theme}}，current',
    names: {
      'megumi-warm': 'Megumi Warm',
      'neutral-light': 'Neutral Light',
      'graphite-dark': 'Graphite Dark',
      'sage-mist': 'Sage Mist',
      'midnight-blue': 'Midnight Blue',
    },
  },
} as const;
