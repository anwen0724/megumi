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
    for (const themeName of themeNames) {
      expect(themeDefinitions[themeName]).toEqual(expect.objectContaining({ name: themeName }));
      expect(themeDefinitions[themeName]).not.toHaveProperty('label');
    }
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
