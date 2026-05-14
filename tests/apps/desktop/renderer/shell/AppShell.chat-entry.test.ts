// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const appShellSourcePath = resolve(repoRoot, 'apps/desktop/src/renderer/shell/AppShell.tsx');

function readAppShellSource() {
  return readFileSync(appShellSourcePath, 'utf8');
}

describe('AppShell chat entry', () => {
  it('uses ChatTimeline for the center workspace', () => {
    const source = readAppShellSource();

    expect(source).toContain("from '../features/chat'");
    expect(source).toContain('<ChatTimeline />');
  });

  it('does not import the temporary center workspace component', () => {
    const source = readAppShellSource();

    expect(source).not.toContain('CenterWorkspacePlaceholder');
  });
});
