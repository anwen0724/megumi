// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const appShellSourcePath = resolve(repoRoot, 'apps/desktop/src/renderer/shell/AppShell.tsx');

function readAppShellSource() {
  return readFileSync(appShellSourcePath, 'utf8');
}

describe('AppShell right panel entry', () => {
  it('uses RightWorkspacePanel for the right workspace', () => {
    const source = readAppShellSource();

    expect(source).toContain("from './RightWorkspacePanel'");
    expect(source).toContain('<RightWorkspacePanel');
  });

  it('does not import the temporary right workspace component', () => {
    const source = readAppShellSource();

    expect(source).not.toContain('RightWorkspacePlaceholder');
  });
});
