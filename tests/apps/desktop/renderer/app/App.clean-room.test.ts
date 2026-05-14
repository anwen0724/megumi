// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const appSourcePath = resolve(repoRoot, 'apps/desktop/src/renderer/app/App.tsx');

function readAppSource() {
  return readFileSync(appSourcePath, 'utf8');
}

describe('App clean-room UI entry', () => {
  it('uses the new AppShell entry', () => {
    const source = readAppSource();

    expect(source).toContain("from '../shell/AppShell'");
  });

  it('does not import old visual shell components', () => {
    const source = readAppSource();

    expect(source).not.toContain("from '../shell/TopBar'");
    expect(source).not.toContain("from '../shell/MainWorkspace'");
    expect(source).not.toContain("from '../shell/RightPanel'");
    expect(source).not.toContain("from '../shell/FileTree'");
    expect(source).not.toContain("from '../shell/ContextPanel'");
  });

  it('does not render legacy brand or garbled copy', () => {
    const source = readAppSource();

    expect(source).not.toContain('Megumi Agent Platform');
    expect(source).not.toMatch(/[�]/);
  });
});
