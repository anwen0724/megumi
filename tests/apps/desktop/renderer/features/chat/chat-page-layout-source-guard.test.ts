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
        continue;
      }

      if (entryPath.endsWith('.ts') || entryPath.endsWith('.tsx')) {
        sources.push(readFileSync(entryPath, 'utf8'));
      }
    }
  }

  visit(chatRoot);
  return sources.join('\n');
}

describe('chat page layout source guard', () => {
  it('keeps ChatPage split into ChatArea and ComposerArea', () => {
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');

    expect(chatPage).toContain('<ChatArea');
    expect(chatPage).toContain('<ComposerArea');
  });

  it('keeps composer outside the timeline role log', () => {
    const messageColumn = readSource('apps/desktop/src/renderer/features/chat/components/MessageColumn.tsx');
    const composerArea = readSource('apps/desktop/src/renderer/features/chat/components/ComposerArea.tsx');

    expect(messageColumn).toContain('role="log"');
    expect(messageColumn).not.toContain('<Composer');
    expect(composerArea).toContain('<Composer');
  });

  it('removes the old ChatTimeline page component and dock layout from production chat sources', () => {
    const chatIndex = readSource('apps/desktop/src/renderer/features/chat/index.ts');
    const chatSources = readProductionChatSources();

    expect(chatIndex).toContain("export { ChatPage } from './pages/ChatPage'");
    expect(chatIndex).not.toContain("export { ChatTimeline }");
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx'))).toBe(false);
    expect(chatSources).not.toContain('chat-composer-dock');
    expect(chatSources).not.toContain('chat-message-scroll-area');
    expect(chatSources).not.toContain('chat-timeline-root');
  });
});
