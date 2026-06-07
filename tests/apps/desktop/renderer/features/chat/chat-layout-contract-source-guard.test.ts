// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function readProductionChatSources(): string {
  const chatRoot = resolve(repoRoot, 'apps/desktop/src/renderer/features/chat');
  const sources: string[] = [];

  function visit(directory: string) {
    for (const entry of readdirSync(directory)) {
      const entryPath = resolve(directory, entry);
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        visit(entryPath);
      } else if (entryPath.endsWith('.ts') || entryPath.endsWith('.tsx')) {
        sources.push(readFileSync(entryPath, 'utf8'));
      }
    }
  }

  visit(chatRoot);
  return sources.join('\n');
}

describe('13.02 chat layout contract source guard', () => {
  it('keeps ChatPage split into ChatViewport', () => {
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');

    expect(chatPage).toContain('<ChatViewport');
    expect(chatPage).not.toContain('<ChatArea');
  });

  it('moves chat layout owners into features/chat/layout', () => {
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/ChatViewport.tsx'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/MessageScrollPanel.tsx'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/MessageColumn.tsx'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/BottomSpacer.tsx'))).toBe(true);
  });

  it('deletes old ChatArea layout owner file', () => {
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/components/ChatArea.tsx'))).toBe(false);
  });

  it('keeps message scrolling in MessageScrollPanel and removes recoverable controls from MessageColumn', () => {
    const messageScrollPanel = readSource('apps/desktop/src/renderer/features/chat/layout/MessageScrollPanel.tsx');
    const messageColumn = readSource('apps/desktop/src/renderer/features/chat/layout/MessageColumn.tsx');
    const bottomSpacer = readSource('apps/desktop/src/renderer/features/chat/layout/BottomSpacer.tsx');
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');

    expect(messageScrollPanel).toContain('data-testid="message-scroll-panel"');
    expect(messageScrollPanel).toContain('overflow-y-auto');
    expect(messageColumn).toContain('role="log"');
    expect(messageColumn).toContain('<BottomSpacer');
    expect(messageColumn).not.toContain('RecoverableActionStack');
    expect(bottomSpacer).toContain('data-testid="message-bottom-spacer"');
    expect(chatPage).toContain('--chat-content-width');
    expect(chatPage).toContain('--chat-composer-width');
    expect(chatPage).toContain('--composer-dock-height');
    expect(chatPage).toContain('--composer-dock-bottom-inset');
  });

  it('keeps forbidden legacy chat layout names out of production chat sources', () => {
    const chatSources = readProductionChatSources();

    expect(chatSources).not.toContain('ChatTimeline');
    expect(chatSources).not.toContain('ChatArea');
    expect(chatSources).not.toContain('chat-composer-dock');
    expect(chatSources).not.toContain('chat-message-scroll-area');
    expect(chatSources).not.toContain('chat-timeline-root');
    expect(chatSources).not.toMatch(/export function \w*(Wrapper|Container)\b/);
  });
});
