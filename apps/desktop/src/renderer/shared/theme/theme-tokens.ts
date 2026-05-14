export type ThemeName = 'megumi-warm' | 'neutral-light';

export const SEMANTIC_THEME_VARIABLES = [
  '--color-app-bg',
  '--color-surface',
  '--color-surface-muted',
  '--color-surface-elevated',
  '--color-border',
  '--color-border-strong',
  '--color-text',
  '--color-text-muted',
  '--color-text-subtle',
  '--color-accent',
  '--color-accent-soft',
  '--color-accent-foreground',
  '--color-danger',
  '--color-danger-soft',
  '--color-warning',
  '--color-warning-soft',
  '--color-success',
  '--color-success-soft',
  '--color-approval',
  '--color-approval-soft',
  '--color-focus',
  '--shadow-soft',
] as const;

export type SemanticThemeVariable = (typeof SEMANTIC_THEME_VARIABLES)[number];

export type ThemeVariables = Record<SemanticThemeVariable, string>;

export interface ThemeDefinition {
  name: ThemeName;
  label: string;
  variables: ThemeVariables;
}

export const themeDefinitions = {
  'megumi-warm': {
    name: 'megumi-warm',
    label: 'Megumi Warm',
    variables: {
      '--color-app-bg': '#f7f3ea',
      '--color-surface': '#fffaf0',
      '--color-surface-muted': '#eee8dd',
      '--color-surface-elevated': '#fffdf7',
      '--color-border': '#ded6c8',
      '--color-border-strong': '#c9bdad',
      '--color-text': '#2f2a24',
      '--color-text-muted': '#81776b',
      '--color-text-subtle': '#aaa096',
      '--color-accent': '#5f8ea1',
      '--color-accent-soft': '#d9e9ec',
      '--color-accent-foreground': '#f8fcfd',
      '--color-danger': '#b45a4f',
      '--color-danger-soft': '#f3ded9',
      '--color-warning': '#a87832',
      '--color-warning-soft': '#f4e6c8',
      '--color-success': '#5f8a68',
      '--color-success-soft': '#dcebdd',
      '--color-approval': '#7d6ea8',
      '--color-approval-soft': '#e9e2f3',
      '--color-focus': '#7aa9b9',
      '--shadow-soft': '0 16px 40px rgba(68, 55, 36, 0.12)',
    },
  },
  'neutral-light': {
    name: 'neutral-light',
    label: 'Neutral Light',
    variables: {
      '--color-app-bg': '#f7f7f5',
      '--color-surface': '#ffffff',
      '--color-surface-muted': '#eeeeec',
      '--color-surface-elevated': '#ffffff',
      '--color-border': '#d8d8d4',
      '--color-border-strong': '#bfc0ba',
      '--color-text': '#272722',
      '--color-text-muted': '#73736c',
      '--color-text-subtle': '#a1a19a',
      '--color-accent': '#56616f',
      '--color-accent-soft': '#e5e8ec',
      '--color-accent-foreground': '#ffffff',
      '--color-danger': '#ad514b',
      '--color-danger-soft': '#f1dcda',
      '--color-warning': '#9a7338',
      '--color-warning-soft': '#efe4cf',
      '--color-success': '#587d60',
      '--color-success-soft': '#dfe9e0',
      '--color-approval': '#6f668a',
      '--color-approval-soft': '#e7e4ef',
      '--color-focus': '#7d8794',
      '--shadow-soft': '0 16px 40px rgba(30, 31, 28, 0.1)',
    },
  },
} satisfies Record<ThemeName, ThemeDefinition>;

export const themeNames = Object.keys(themeDefinitions) as ThemeName[];

export function getThemeDefinition(theme: ThemeName): ThemeDefinition {
  return themeDefinitions[theme];
}

export function getNextThemeName(theme: ThemeName): ThemeName {
  return theme === 'megumi-warm' ? 'neutral-light' : 'megumi-warm';
}
