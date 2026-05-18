// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function readJsxTextAndStringProps(source: string): string {
  const jsxText = Array.from(source.matchAll(/>\s*([^<>{}\n][^<>{}]*)\s*</g), (match) => match[1]);
  const stringProps = Array.from(source.matchAll(/\b(?:aria-label|placeholder|label|title)=["']([^"']+)["']/g), (match) => match[1]);
  const stringLabels = Array.from(source.matchAll(/\blabel:\s*["']([^"']+)["']/g), (match) => match[1]);

  return [...jsxText, ...stringProps, ...stringLabels].join('\n');
}

function readTabLabels(source: string): string[] {
  return Array.from(source.matchAll(/\blabel:\s*["']([^"']+)["']/g), (match) => match[1]);
}

describe('composer source guard', () => {
  it('keeps shortcut hints and running draft explanations out of persistent composer copy', () => {
    const composer = readSource('apps/desktop/src/renderer/features/chat/components/Composer.tsx');
    const composerCopy = readJsxTextAndStringProps(composer);

    expect(composer).not.toMatch(/Shift\s*\+\s*Enter|Alt\s*\+\s*Enter/i);
    expect(composerCopy).not.toMatch(/\bshortcut\b/i);
    expect(composer).not.toMatch(/Draft a follow-up|while Megumi works|next message after this run/i);
  });

  it('does not move composer mode or model controls into the titlebar', () => {
    const titlebar = readSource('apps/desktop/src/renderer/shell/WindowTitleBar.tsx');

    expect(titlebar).not.toMatch(/Composer mode|Model|deepseek|gpt-|claude-/i);
  });

  it('does not introduce a right panel Run tab from composer work', () => {
    const rightPanel = readSource('apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx');

    expect(readTabLabels(rightPanel)).not.toContain('Run');
  });
});
