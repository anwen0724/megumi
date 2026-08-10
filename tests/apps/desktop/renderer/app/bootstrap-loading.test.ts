/* Protects main-window startup from eagerly transforming character-only voice dependencies. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('renderer bootstrap loading', () => {
  it('keeps the entry module free of static imports so HTML can paint first', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/desktop/src/renderer/app/bootstrap.tsx'),
      'utf8',
    );
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/desktop/src/renderer/index.html'),
      'utf8',
    );

    expect(source).not.toMatch(/^import\s/m);
    expect(source).toContain("import('./renderer-bootstrap')");
    expect(html).toContain('id="megumi-startup-shell"');
    expect(html).toContain('megumi-startup-orbit');
    expect(html).toContain('@keyframes megumi-startup-spin');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain("classList.add('is-leaving')");
  });

  it('binds the development renderer to the same IPv4 address Electron loads', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'vite.renderer.config.ts'),
      'utf8',
    );

    expect(source).toContain("host: '127.0.0.1'");
  });

  it('limits Tailwind source detection to renderer files', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/desktop/src/renderer/shared/styles/globals.css'),
      'utf8',
    );

    expect(source).toContain('@import "tailwindcss" source(none);');
    expect(source).toContain('@source "../..";');
  });

  it('loads CharacterApp only for the character window role', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/desktop/src/renderer/app/renderer-bootstrap.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(/^import CharacterApp/m);
    expect(source).toContain("import('./CharacterApp')");
  });
});
