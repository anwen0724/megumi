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
  it('keeps ChatPage split into ChatViewport and ComposerDock', () => {
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');

    expect(chatPage).toContain('<ChatViewport');
    expect(chatPage).toContain('<ComposerDock');
    expect(chatPage).not.toContain('<ChatArea');
    expect(chatPage).not.toContain('<ComposerArea');
  });

  it('moves chat layout owners into features/chat/layout', () => {
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/ChatViewport.tsx'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/ComposerDock.tsx'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/MessageScrollPanel.tsx'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/MessageColumn.tsx'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/layout/BottomSpacer.tsx'))).toBe(true);
  });

  it('deletes old ambiguous layout owner files', () => {
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/components/ChatArea.tsx'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/components/ComposerArea.tsx'))).toBe(false);
  });

  it('keeps message scrolling in MessageScrollPanel and composer input in ComposerDock', () => {
    const messageScrollPanel = readSource('apps/desktop/src/renderer/features/chat/layout/MessageScrollPanel.tsx');
    const messageColumn = readSource('apps/desktop/src/renderer/features/chat/layout/MessageColumn.tsx');
    const bottomSpacer = readSource('apps/desktop/src/renderer/features/chat/layout/BottomSpacer.tsx');
    const composerDock = readSource('apps/desktop/src/renderer/features/chat/layout/ComposerDock.tsx');
    const composer = readSource('apps/desktop/src/renderer/features/chat/components/Composer.tsx');
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');

    expect(messageScrollPanel).toContain('data-testid="message-scroll-panel"');
    expect(messageScrollPanel).toContain('overflow-y-auto');
    expect(messageColumn).toContain('role="log"');
    expect(messageColumn).toContain('<BottomSpacer');
    expect(messageColumn).not.toContain('RecoverableActionStack');
    expect(bottomSpacer).toContain('data-testid="message-bottom-spacer"');
    expect(composerDock).toContain('data-testid="composer-dock"');
    expect(composerDock).toContain('data-testid="composer-dock-content"');
    expect(composerDock).toContain('bg-transparent');
    expect(composerDock).toContain('pb-3');
    expect(composerDock).not.toContain('pb-6');
    expect(composerDock).toContain('<ApprovalStack');
    expect(composerDock).toContain('<RecoverableActionStack');
    expect(composerDock).toContain('<BranchDraftStack');
    expect(composerDock).toContain('<Composer');
    expect(composer).not.toContain('composer-branch-draft-row');
    expect(chatPage).toContain('--chat-column-width');
    expect(chatPage).toContain('--composer-dock-height');
    expect(chatPage).toContain('--composer-dock-bottom-inset');
    expect(chatPage).not.toContain('--composer-dock-cut-inset');
    expect(chatPage).not.toContain('--chat-content-width');
    expect(chatPage).not.toContain('--chat-composer-width');
    expect(messageScrollPanel).toContain('bottom-4');
    expect(messageScrollPanel).not.toContain('h-full min-h-0 overflow-y-auto');
    expect(messageColumn).toContain('max-w-[var(--chat-column-width)]');
    expect(composerDock).toContain('max-w-[var(--chat-column-width)]');
  });

  it('keeps forbidden legacy chat layout names out of production chat sources', () => {
    const chatSources = readProductionChatSources();

    expect(chatSources).not.toContain('ChatTimeline');
    expect(chatSources).not.toContain('ChatArea');
    expect(chatSources).not.toContain('ComposerArea');
    expect(chatSources).not.toContain('chat-composer-dock');
    expect(chatSources).not.toContain('chat-message-scroll-area');
    expect(chatSources).not.toContain('chat-timeline-root');
    expect(chatSources).not.toMatch(/export function \w*(Wrapper|Container)\b/);
  });
});
