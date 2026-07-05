// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('13.02 shell layout contract source guard', () => {
  it('uses App as the long-term renderer shell root instead of AppShell', () => {
    const app = readSource('apps/desktop/src/renderer/app/App.tsx');

    expect(app).toContain('<WindowTitleBar');
    expect(app).toContain('<AppBody');
    expect(app).toContain('--main-content-width');
    expect(app).toContain('--right-sidebar-width');
    expect(app).not.toContain('AppShell');
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/shell/AppShell.tsx'))).toBe(false);
  });

  it('keeps AppBody as top-level SettingsPage or the chat shell layout', () => {
    const appBody = readSource('apps/desktop/src/renderer/shell/AppBody.tsx');
    const rightSidebar = readSource('apps/desktop/src/renderer/shell/RightSidebar.tsx');

    expect(appBody).toContain('data-testid="app-body"');
    expect(appBody).toContain('<SettingsPage');
    expect(appBody).toContain('settingsOpen ?');
    expect(appBody).toContain('<LeftSidebar');
    expect(appBody).toContain('<MainContent');
    expect(appBody).toContain('<RightSidebar');
    expect(appBody.indexOf('<LeftSidebar')).toBeLessThan(appBody.indexOf('<MainContent'));
    expect(appBody.indexOf('<MainContent')).toBeLessThan(appBody.indexOf('<RightSidebar'));
    expect(appBody).not.toMatch(/useProjectStore|useSessionStore|useWorkspaceFilesStore|useSessionHistoryHydration|useChatStreamStore/);
    expect(rightSidebar).toContain('w-[var(--right-sidebar-width)]');
    expect(rightSidebar).toContain('w-0');
  });

  it('keeps MainContent as PageHost + MainOverlays', () => {
    const mainContent = readSource('apps/desktop/src/renderer/shell/MainContent.tsx');

    expect(mainContent).toContain('data-testid="main-content"');
    expect(mainContent).toContain('<PageHost');
    expect(mainContent).toContain('<MainOverlays');
    expect(mainContent).toContain('min-w-[var(--main-content-width)]');
    expect(mainContent).not.toContain('min-w-[42rem]');
    expect(mainContent).not.toContain('<RightSidebar');
    expect(mainContent).not.toContain('<LeftSidebar');
  });

  it('keeps PageHost as the main chat page outlet', () => {
    const pageHost = readSource('apps/desktop/src/renderer/shell/PageHost.tsx');

    expect(pageHost).toContain('data-testid="page-host"');
    expect(pageHost).toContain('className="relative flex min-h-0 flex-1 overflow-hidden"');
    expect(pageHost).toContain('<ChatPage');
    expect(pageHost).not.toMatch(/SettingsPage|RightSidebar|WindowTitleBar|LeftSidebar/);
  });

  it('keeps shell layout away from renderer-forbidden internals', () => {
    const shellFiles = [
      'apps/desktop/src/renderer/app/App.tsx',
      'apps/desktop/src/renderer/shell/AppBody.tsx',
      'apps/desktop/src/renderer/shell/MainContent.tsx',
      'apps/desktop/src/renderer/shell/PageHost.tsx',
      'apps/desktop/src/renderer/shell/MainOverlays.tsx',
      'apps/desktop/src/renderer/shell/WindowTitleBar.tsx',
      'apps/desktop/src/renderer/shell/RightSidebar.tsx',
      'apps/desktop/src/renderer/shell/LeftSidebar.tsx',
      'apps/desktop/src/renderer/shell/SettingsPage.tsx',
    ];

    // Only check files that already exist; new shell files checked after creation
    const combined = shellFiles
      .filter((f) => existsSync(resolve(repoRoot, f)))
      .map(readSource)
      .join('\n');

    expect(combined).not.toMatch(/from ['"]electron['"]/);
    expect(combined).not.toMatch(/from ['"]node:fs['"]|from ['"]fs['"]|require\(['"]fs['"]\)/);
    expect(combined).not.toMatch(/packages\/core|packages\/db|packages\/runtime|better-sqlite3|provider adapter/i);
  });

  it('uses layout contract names instead of generic core owner names in shell', () => {
    const shellDir = 'apps/desktop/src/renderer/shell/';
    const shellFiles = ['AppBody.tsx', 'MainContent.tsx', 'PageHost.tsx', 'MainOverlays.tsx'];

    const combined = shellFiles
      .filter((f) => existsSync(resolve(repoRoot, shellDir + f)))
      .map((f) => readSource(shellDir + f))
      .join('\n');

    expect(combined).not.toMatch(/export function \w*(Wrapper|Container)\b/);
  });
});
