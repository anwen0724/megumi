// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('composer source guard', () => {
  it('keeps shortcut hints and running draft explanations out of persistent composer copy', () => {
    const composer = readSource('apps/desktop/src/renderer/features/chat/components/Composer.tsx');

    expect(composer).not.toMatch(/Shift\s*\+\s*Enter|Alt\s*\+\s*Enter|shortcut/i);
    expect(composer).not.toMatch(/Draft a follow-up|while Megumi works|next message after this run/i);
  });

  it('does not move composer mode or model controls into the titlebar', () => {
    const titlebar = readSource('apps/desktop/src/renderer/shell/WindowTitleBar.tsx');

    expect(titlebar).not.toMatch(/Composer mode|Model|deepseek|gpt-|claude-/i);
  });

  it('does not introduce a right panel Run tab from composer work', () => {
    const rightPanel = readSource('apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx');

    expect(rightPanel).not.toMatch(/Run/);
  });
});
