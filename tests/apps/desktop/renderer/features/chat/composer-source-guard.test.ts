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
    expect(composer).not.toMatch(/next message after this run/i);
  });

  it('does not move composer mode or model controls into the titlebar', () => {
    const titlebar = readSource('apps/desktop/src/renderer/shell/WindowTitleBar.tsx');

    expect(titlebar).not.toMatch(/Composer mode|Model|deepseek|gpt-|claude-/i);
  });

  it('does not introduce a right panel Run tab from composer work', () => {
    const rightSidebar = readSource('apps/desktop/src/renderer/shell/RightSidebar.tsx');

    expect(readTabLabels(rightSidebar)).not.toContain('Run');
  });

  it('keeps composer toolbar controls on one line', () => {
    const composer = readSource('apps/desktop/src/renderer/features/chat/components/Composer.tsx');

    expect(composer).toMatch(/data-testid="composer-toolbar" className="[^"]*\bflex-nowrap\b/);
    expect(composer).not.toMatch(/data-testid="composer-toolbar" className="[^"]*\bflex-wrap\b/);
    expect(composer).not.toMatch(/data-testid="composer-toolbar"[\s\S]*?\bflex-wrap\b[\s\S]*?aria-label="Send message"/);
    expect(composer).toMatch(/data-testid="composer-actions"[\s\S]*className="[^"]*\bshrink-0\b/);
    expect(composer).toMatch(/aria-label="Send message"[\s\S]*className="[^"]*\bshrink-0\b/);
    expect(composer).toMatch(/aria-label="Stop current run"[\s\S]*className="[^"]*\bshrink-0\b/);
  });

  it('keeps composer in ComposerDock and message scrolling in MessageScrollPanel', () => {
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');
    const messageScrollPanel = readSource('apps/desktop/src/renderer/features/chat/layout/MessageScrollPanel.tsx');
    const composerArea = readSource('apps/desktop/src/renderer/features/chat/components/ComposerArea.tsx');
    const messageColumn = readSource('apps/desktop/src/renderer/features/chat/layout/MessageColumn.tsx');

    expect(chatPage).toContain('<ChatViewport');
    expect(chatPage).not.toContain('<ChatArea');
    expect(messageScrollPanel).toContain('data-testid="message-scroll-panel"');
    expect(messageScrollPanel).toContain('overflow-y-auto');
    expect(messageColumn).toContain('data-testid="message-column"');
    expect(messageColumn).toContain('<BottomSpacer');
    expect(composerArea).toContain('data-testid="composer-area"');
    expect(composerArea).toContain('<Composer');
    expect(chatPage).not.toContain('chat-composer-dock');
    expect(chatPage).not.toContain('chat-message-scroll-area');
  });
});
