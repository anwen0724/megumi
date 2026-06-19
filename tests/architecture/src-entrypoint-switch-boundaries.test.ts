// Locks the final Phase 21 entrypoint switch to src/desktop and src/ui.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('src Electron/Vite entrypoint switch', () => {
  it('uses src/desktop for Forge main and preload entries', () => {
    const forgeConfig = read('forge.config.ts');

    expect(forgeConfig).toContain("entry: 'src/desktop/main.ts'");
    expect(forgeConfig).toContain("entry: 'src/desktop/preload/index.ts'");
    expect(forgeConfig).not.toContain("entry: 'apps/desktop/src/main/index.ts'");
    expect(forgeConfig).not.toContain("entry: 'apps/desktop/src/preload/index.ts'");
  });

  it('uses src/ui as the renderer root', () => {
    const rendererConfig = read('vite.renderer.config.ts');

    expect(rendererConfig).toContain("root: 'src/ui'");
    expect(rendererConfig).not.toContain("root: 'apps/desktop/src/renderer'");
  });

  it('typechecks src directly', () => {
    const tsconfig = read('tsconfig.json');

    expect(tsconfig).toContain('"src/**/*"');
    expect(tsconfig).toContain('"@megumi/renderer-contracts"');
  });
});
