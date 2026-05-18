// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readSource(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('UI polish source guard', () => {
  it('keeps the titlebar focused on session identity and window controls', () => {
    const source = readSource('apps/desktop/src/renderer/shell/WindowTitleBar.tsx');

    expect(source).not.toMatch(/workspacePath|workspace path|context count|tool count|artifact count/i);
    expect(source).not.toMatch(/Composer mode|Model|run status/i);
  });

  it('keeps the right workspace panel as an integrated workspace surface without Tasks or Run tabs', () => {
    const source = readSource('apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx');

    expect(source).not.toMatch(/<Panel(?:\s|>)/);
    expect(source).not.toContain('PanelHeader');
    expect(source).not.toContain('TasksPanelTab');
    expect(source).not.toMatch(/label:\s*['"]Tasks['"]/);
    expect(source).not.toMatch(/label:\s*['"]Run['"]/);
    expect(source).toContain('data-testid="right-workspace-panel"');
  });

  it('keeps composer shortcuts out of persistent visible UI copy', () => {
    const source = readSource('apps/desktop/src/renderer/features/chat/components/Composer.tsx');

    expect(source).not.toMatch(/Shift\s*\+\s*Enter/i);
    expect(source).not.toMatch(/Alt\s*\+\s*Enter/i);
    expect(source).not.toMatch(/keyboard shortcut/i);
  });

  it('keeps renderer workspace panel code away from direct Host APIs', () => {
    const files = [
      'apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx',
      'apps/desktop/src/renderer/features/workspace-panel/components/FilesPanelTab.tsx',
      'apps/desktop/src/renderer/entities/workspace-files/store.ts',
    ];
    const combined = files.map(readSource).join('\n');

    expect(combined).not.toMatch(/from ['"]electron['"]/);
    expect(combined).not.toMatch(/from ['"]node:fs['"]|from ['"]fs['"]|require\(['"]fs['"]\)/);
  });
});
