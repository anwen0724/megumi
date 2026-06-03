// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_THEME_VARIABLES,
  getThemeDefinition,
  themeDefinitions,
  themeNames,
} from '@megumi/desktop/renderer/shared/theme';

describe('theme tokens', () => {
  it('defines the built-in desktop themes', () => {
    expect(themeNames).toEqual(['megumi-warm', 'neutral-light', 'graphite-dark', 'sage-mist', 'midnight-blue']);
    expect(themeDefinitions['megumi-warm'].label).toBe('Megumi Warm');
    expect(themeDefinitions['neutral-light'].label).toBe('Neutral Light');
    expect(themeDefinitions['graphite-dark'].label).toBe('Graphite Dark');
    expect(themeDefinitions['sage-mist'].label).toBe('Sage Mist');
    expect(themeDefinitions['midnight-blue'].label).toBe('Midnight Blue');
  });

  it('provides every semantic variable for every theme', () => {
    for (const themeName of themeNames) {
      const definition = getThemeDefinition(themeName);

      for (const variableName of SEMANTIC_THEME_VARIABLES) {
        expect(definition.variables[variableName], `${themeName} ${variableName}`).toBeTruthy();
      }
    }
  });

  it('uses distinct app background values across built-in themes', () => {
    const appBackgrounds = themeNames.map((themeName) => themeDefinitions[themeName].variables['--color-app-bg']);

    expect(new Set(appBackgrounds).size).toBe(themeNames.length);
  });
});
