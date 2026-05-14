// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_THEME_VARIABLES,
  getThemeDefinition,
  themeDefinitions,
  themeNames,
} from '@megumi/desktop/renderer/shared/theme';

describe('theme tokens', () => {
  it('defines both first-pass desktop themes', () => {
    expect(themeNames).toEqual(['megumi-warm', 'neutral-light']);
    expect(themeDefinitions['megumi-warm'].label).toBe('Megumi Warm');
    expect(themeDefinitions['neutral-light'].label).toBe('Neutral Light');
  });

  it('provides every semantic variable for every theme', () => {
    for (const themeName of themeNames) {
      const definition = getThemeDefinition(themeName);

      for (const variableName of SEMANTIC_THEME_VARIABLES) {
        expect(definition.variables[variableName], `${themeName} ${variableName}`).toBeTruthy();
      }
    }
  });

  it('uses different app background values for warm and neutral themes', () => {
    expect(themeDefinitions['megumi-warm'].variables['--color-app-bg']).not.toBe(
      themeDefinitions['neutral-light'].variables['--color-app-bg'],
    );
  });
});
