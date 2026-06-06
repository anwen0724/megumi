// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('chat page layout source guard', () => {
  it('keeps ChatPage split into ChatArea and ComposerArea', () => {
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');

    expect(chatPage).toContain('<ChatArea');
    expect(chatPage).toContain('<ComposerArea');
    expect(chatPage).not.toContain('data-testid="chat-composer-dock"');
    expect(chatPage).not.toContain('data-testid="chat-message-scroll-area"');
  });

  it('keeps composer outside the timeline role log', () => {
    const messageColumn = readSource('apps/desktop/src/renderer/features/chat/components/MessageColumn.tsx');
    const composerArea = readSource('apps/desktop/src/renderer/features/chat/components/ComposerArea.tsx');

    expect(messageColumn).toContain('role="log"');
    expect(messageColumn).not.toContain('<Composer');
    expect(composerArea).toContain('<Composer');
  });

  it('keeps old ChatTimeline from owning page layout', () => {
    const chatIndex = readSource('apps/desktop/src/renderer/features/chat/index.ts');
    expect(chatIndex).toContain("export { ChatPage } from './pages/ChatPage'");
    expect(chatIndex).not.toContain("export { ChatTimeline }");
  });
});
