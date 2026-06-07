// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('interaction baseline source guards', () => {
  it('keeps the custom shell entry points wired together', () => {
    const app = readSource('apps/desktop/src/renderer/app/App.tsx');
    const appBody = readSource('apps/desktop/src/renderer/shell/AppBody.tsx');

    expect(app).toContain("from '../shell/WindowTitleBar'");
    expect(app).toContain("from '../shell/AppBody'");
    expect(appBody).toContain("from './LeftSidebar'");
    expect(appBody).toContain("from './MainContent'");
    expect(appBody).toContain("from './RightSidebar'");
    expect(appBody).toContain('rightSidebarOpen');
    expect(appBody).toContain('<RightSidebar');
    expect(appBody).toContain('settingsOpen');
    expect(appBody).not.toContain("from './Settings" + "Modal'");
    expect(appBody).not.toContain('<Settings' + 'Modal');
  });

  it('keeps deleted old visual UI files absent', () => {
    const oldFlowFile = 'mock-' + 'agent-flow';
    const oldHookFile = 'use-' + oldFlowFile;
    const oldVisualFiles = [
      'apps/desktop/src/renderer/shell/TopBar.tsx',
      'apps/desktop/src/renderer/shell/MainWorkspace.tsx',
      'apps/desktop/src/renderer/shell/RightPanel.tsx',
      'apps/desktop/src/renderer/shell/FileTree.tsx',
      'apps/desktop/src/renderer/shell/ContextPanel.tsx',
      'apps/desktop/src/renderer/features/chat/components/ChatView.tsx',
      'apps/desktop/src/renderer/features/chat/components/ChatInput.tsx',
      'apps/desktop/src/renderer/entities/message/MessageBubble.tsx',
      'apps/desktop/src/renderer/entities/tool-call/ToolCallCard.tsx',
      `apps/desktop/src/renderer/features/chat/components/${oldFlowFile}.ts`,
      `apps/desktop/src/renderer/features/chat/hooks/${oldHookFile}.ts`,
    ];

    for (const file of oldVisualFiles) {
      expect(existsSync(resolve(repoRoot, file)), file).toBe(false);
    }
  });

  it('keeps chat feature independent from workspace-panel feature', () => {
    const chatFiles = [
      'apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx',
      'apps/desktop/src/renderer/features/chat/components/MessageColumn.tsx',
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
      'apps/desktop/src/renderer/features/chat/index.ts',
    ];

    for (const file of chatFiles) {
      const source = readSource(file);
      expect(source, file).not.toContain('features/workspace-panel');
      expect(source, file).not.toContain('../workspace-panel');
      expect(source, file).not.toContain('../../workspace-panel');
    }
  });

  it('keeps obsolete workspace-state entity absent', () => {
    const workspaceStateFiles = [
      'apps/desktop/src/renderer/entities/workspace-state/store.ts',
      'apps/desktop/src/renderer/entities/workspace-state/WorkspaceTaskCard.tsx',
      'apps/desktop/src/renderer/entities/workspace-state/index.ts',
    ];

    for (const file of workspaceStateFiles) {
      expect(existsSync(resolve(repoRoot, file)), file).toBe(false);
    }
  });

  it('keeps renderer out of direct Electron imports', () => {
    const rendererEntryFiles = [
      'apps/desktop/src/renderer/shell/WindowTitleBar.tsx',
      'apps/desktop/src/renderer/shared/ipc/client.ts',
      'apps/desktop/src/renderer/features/chat/pages/ChatPage.tsx',
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
    ];

    for (const file of rendererEntryFiles) {
      const source = readSource(file);
      expect(source, file).not.toMatch(/from ['"]electron['"]/);
      expect(source, file).not.toMatch(/require\(['"]electron['"]\)/);
    }
  });

  it('keeps visible keyboard focus and quiet scrollbars in global styles', () => {
    const globals = readSource('apps/desktop/src/renderer/shared/styles/globals.css');

    expect(globals).toContain(':focus-visible');
    expect(globals).toContain('outline: 2px solid var(--color-focus)');
    expect(globals).toContain('scrollbar-color: var(--color-border-strong) transparent');
    expect(globals).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globals).toContain('animation-duration: 0.01ms !important');
  });
});
