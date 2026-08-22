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
    expect(themeNames).toEqual([
      'megumi-warm',
      'neutral-light',
      'sunlit-sky',
      'rose-moon',
      'verdant-cloud',
      'cangming-blue',
      'frost-cyan',
      'cyan-tide',
      'midnight-blue',
    ]);
    for (const themeName of themeNames) {
      expect(themeDefinitions[themeName]).toEqual(expect.objectContaining({ name: themeName }));
      expect(themeDefinitions[themeName]).not.toHaveProperty('label');
    }
  });

  it('preserves the six supplied complementary color pairs in semantic theme tokens', () => {
    expect(themeDefinitions['sunlit-sky'].variables).toMatchObject({
      '--color-surface-muted': '#f4dc84',
      '--color-accent': '#79bedf',
    });
    expect(themeDefinitions['rose-moon'].variables).toMatchObject({
      '--color-surface-muted': '#e8f0f2',
      '--color-accent': '#d87888',
    });
    expect(themeDefinitions['verdant-cloud'].variables).toMatchObject({
      '--color-app-bg': '#fbf1d7',
      '--color-accent': '#73ae52',
    });
    expect(themeDefinitions['cangming-blue'].variables).toMatchObject({
      '--color-app-bg': '#faf2e0',
      '--color-accent': '#0e61ac',
    });
    expect(themeDefinitions['frost-cyan'].variables).toMatchObject({
      '--color-app-bg': '#fcf9e8',
      '--color-accent': '#00b7c7',
    });
    expect(themeDefinitions['cyan-tide'].variables).toMatchObject({
      '--color-surface-muted': '#b1d5c9',
      '--color-accent': '#00b7c7',
    });
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
