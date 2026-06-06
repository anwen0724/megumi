// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readSource(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('UI polish source guard', () => {
  it('keeps the titlebar focused on session identity and window controls', () => {
    const source = readSource('apps/desktop/src/renderer/shell/WindowTitleBar.tsx');

    expect(source).not.toMatch(/workspacePath|workspace path|context count|tool count|artifact count/i);
    expect(source).not.toMatch(/Composer mode|Model|run status/i);
  });

  it('keeps the right workspace panel as an integrated workspace surface without Tasks or Run tabs', () => {
    const source = readSource('apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx');

    expect(source).not.toMatch(/<Panel(?:\s|>)/);
    expect(source).not.toContain('PanelHeader');
    expect(source).not.toContain('TasksPanelTab');
    expect(source).not.toMatch(/label:\s*['"]Tasks['"]/);
    expect(source).not.toMatch(/label:\s*['"]Run['"]/);
    expect(source).toContain('data-testid="right-workspace-panel"');
  });

  it('keeps the right workspace panel scoped to Workspace Files and Artifacts views', () => {
    const rightPanel = readSource('apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx');

    expect(rightPanel).toContain("'workspace' | 'files' | 'artifacts'");
    expect(rightPanel).toContain('aria-label={`Open ${title} workspace view`}');
    expect(rightPanel).toContain('title="Files"');
    expect(rightPanel).toContain('Back to Workspace');
    expect(rightPanel).not.toMatch(/ContextPanelTab|MemoryPanelTab|Run dashboard|active path tree|branch tree|tool rail/i);
    expect(rightPanel).not.toMatch(/PanelTitle>\s*Tools|label:\s*['"]Tools['"]|>\s*Tools\s*</);
  });

  it('keeps Settings as a main-area page instead of an overlay modal', () => {
    const appShell = readSource('apps/desktop/src/renderer/shell/AppShell.tsx');
    const settingsPage = readSource('apps/desktop/src/renderer/shell/SettingsPage.tsx');

    expect(appShell).toContain("from './SettingsPage'");
    expect(appShell).toContain('<SettingsPage');
    expect(appShell).not.toContain('Settings' + 'Modal');
    expect(settingsPage).toContain('data-testid="settings-page"');
    expect(settingsPage).toContain('grid-cols-[13rem_minmax(0,1fr)]');
    expect(settingsPage).not.toMatch(new RegExp([
      'role=["\']dialog["\']',
      'aria-modal',
      'fixed inset-0',
      'Close settings ' + 'overlay',
    ].join('|')));
    expect(settingsPage).not.toMatch(/Memory|Context debug|Run dashboard|Checkpoint/);
  });

  it('keeps the focus canvas free of timeline rails and assistant cards', () => {
    const chatTimeline = readSource('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx');
    const timelineMessage = readSource('apps/desktop/src/renderer/features/chat/components/TimelineMessage.tsx');

    expect(chatTimeline).toContain('max-w-3xl');
    expect(chatTimeline).not.toMatch(/pr-16|xl:pr-32/);
    expect(chatTimeline).toContain('transition-[padding,width]');
    expect(timelineMessage).not.toMatch(/timeline-rail|border-l-2.*article|steps rail/i);
    expect(timelineMessage).not.toMatch(/isAssistant\s*\?\s*['"][^'"]*rounded-lg/);
  });

  it('keeps composer shortcuts out of persistent visible UI copy', () => {
    const source = readSource('apps/desktop/src/renderer/features/chat/components/Composer.tsx');

    expect(source).not.toMatch(/Shift\s*\+\s*Enter/i);
    expect(source).not.toMatch(/Alt\s*\+\s*Enter/i);
    expect(source).not.toMatch(/keyboard shortcut/i);
  });

  it('keeps renderer workspace panel code away from direct Host APIs', () => {
    const files = [
      'apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx',
      'apps/desktop/src/renderer/features/workspace-panel/components/FilesPanelTab.tsx',
      'apps/desktop/src/renderer/entities/workspace-files/store.ts',
    ];
    const combined = files.map(readSource).join('\n');

    expect(combined).not.toMatch(/from ['"]electron['"]/);
    expect(combined).not.toMatch(/from ['"]node:fs['"]|from ['"]fs['"]|require\(['"]fs['"]\)/);
  });
});
