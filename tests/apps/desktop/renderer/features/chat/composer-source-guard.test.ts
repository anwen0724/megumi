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
    const rightPanel = readSource('apps/desktop/src/renderer/shell/RightSidebar.tsx');

    expect(readTabLabels(rightPanel)).not.toContain('Run');
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

  it('keeps the message scrollbar full-width while sharing the chat content column', () => {
    const timeline = readSource('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx');
    const appShell = readSource('apps/desktop/src/renderer/shell/AppShell.tsx');

    expect(timeline).toMatch(/data-testid="chat-timeline-root"[\s\S]*?className="[^"]*\brelative\b[^"]*\bflex\b[^"]*\bflex-col\b[^"]*\boverflow-hidden\b/);
    expect(timeline).toMatch(/data-testid="chat-timeline-root"[\s\S]*?className="[^"]*\bmin-w-\[42rem\]/);
    expect(timeline).toMatch(/data-testid="chat-message-scroll-area"[\s\S]*?className="[^"]*\bflex-1\b[^"]*\boverflow-y-auto\b/);
    expect(timeline).toMatch(/data-testid="chat-message-content-column"[\s\S]*?className=\{CHAT_CONTENT_COLUMN_CLASS\}/);
    expect(timeline).toMatch(/data-testid="chat-composer-dock"[\s\S]*?className="[^"]*\bshrink-0\b[^"]*\bbg-\[var\(--color-app-bg\)\]/);
    expect(timeline).toMatch(/data-testid="chat-composer-content-column"[\s\S]*?className=\{CHAT_CONTENT_COLUMN_CLASS\}/);
    expect(timeline).not.toContain('chat-content-shell');
    expect(timeline).not.toContain('chat-message-section');
    expect(timeline).not.toContain('chat-bottom-base');
    expect(timeline).not.toContain('chat-composer-overlay');
    expect(timeline).not.toContain('chat-composer-content-shell');
    expect(appShell).toMatch(/data-testid="workbench-content"[\s\S]*?className="[^"]*\bmin-w-\[62rem\]/);
  });
});
