// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const appShellSourcePath = resolve(repoRoot, 'apps/desktop/src/renderer/shell/AppShell.tsx');

function readAppShellSource() {
  return readFileSync(appShellSourcePath, 'utf8');
}

describe('AppShell custom window chrome entry', () => {
  it('uses WindowTitleBar for the top chrome', () => {
    const source = readAppShellSource();

    expect(source).toContain("from './WindowTitleBar'");
    expect(source).toContain('<WindowTitleBar');
  });

  it('does not render the old inline top header', () => {
    const source = readAppShellSource();

    expect(source).not.toContain('<header className="flex h-12');
    expect(source).not.toContain("import { ThemeToggle } from '../shared/theme'");
  });
});
