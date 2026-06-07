// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('right sidebar source guard', () => {
  it('uses RightSidebar as the production shell component name', () => {
    const appBody = readSource('apps/desktop/src/renderer/shell/AppBody.tsx');
    const rightSidebar = readSource('apps/desktop/src/renderer/shell/RightSidebar.tsx');

    expect(appBody).toContain("from './RightSidebar'");
    expect(appBody).not.toContain("from './RightWorkspacePanel'");
    expect(rightSidebar).toContain('export function RightSidebar');
    expect(rightSidebar).not.toContain('export function RightWorkspacePanel');
  });

  it('keeps the right sidebar as an occupied shell sibling, not a ChatPage child', () => {
    const appBody = readSource('apps/desktop/src/renderer/shell/AppBody.tsx');
    const mainContent = readSource('apps/desktop/src/renderer/shell/MainContent.tsx');
    const chatPage = readSource('apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx');

    expect(appBody).toContain('data-testid="app-body"');
    expect(mainContent).toContain('data-testid="main-content"');
    expect(appBody).toContain('<RightSidebar');
    expect(chatPage).not.toContain('RightSidebar');
    expect(chatPage).not.toContain('RightWorkspacePanel');
  });
});
