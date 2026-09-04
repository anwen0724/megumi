/* Defines source-language copy shared across Desktop Renderer features. */
export const common = {
  settingsRecovery: {
    title: 'Settings could not be loaded',
    description: 'Megumi has not started automatic tasks. Correct the configuration file, then restart. Your settings have not been reset.',
    genericReason: 'Check the file format and access permissions. If this persists, check the application logs.',
    location: 'Configuration file',
    locationUnavailable: 'Configuration location is unavailable.',
    openDirectory: 'Open configuration folder',
    restart: 'Restart Megumi',
    operationFailed: 'The operation could not be completed. Open the file location manually or exit and restart Megumi.',
  },
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
      'sunlit-sky': 'Sunlit Sky',
      'rose-moon': 'Rose Moon',
      'verdant-cloud': 'Verdant Cloud',
      'cangming-blue': 'Cangming Blue',
      'frost-cyan': 'Frost Cyan',
      'cyan-tide': 'Cyan Tide',
      'midnight-blue': 'Midnight Blue',
    },
  },
} as const;
