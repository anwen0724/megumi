// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const rightPanelSourcePath = resolve(repoRoot, 'apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx');

function readRightPanelSource() {
  return readFileSync(rightPanelSourcePath, 'utf8');
}

describe('RightWorkspacePanel responsive ownership', () => {
  it('does not hide the panel through Tailwind breakpoint-only classes', () => {
    const source = readRightPanelSource();

    expect(source).not.toContain('xl:flex');
    expect(source).not.toContain('xl:flex-col');
    expect(source).not.toContain('hidden w-80');
    expect(source).not.toContain('hidden w-12');
  });

  it('renders an occupied sidebar without the old collapsed rail', () => {
    const source = readRightPanelSource();

    expect(source).toContain("'flex shrink-0 overflow-hidden");
    expect(source).toContain("? 'w-80 translate-x-0 flex-col opacity-100'");
    expect(source).toContain(": 'w-0 translate-x-6 flex-col opacity-0 pointer-events-none'");
    expect(source).toContain('SIDEBAR_TRANSITION_MS');
    expect(source).toContain('onTransitionEnd');
    expect(source).not.toContain("'flex w-12 shrink-0");
    expect(source).not.toContain('className="flex w-12 shrink-0');
    expect(source).not.toContain('Expand workspace panel');
    expect(source).not.toContain('Collapse workspace panel');
    expect(source).toContain('return null');
  });

  it('avoids heavy double-background appearance', () => {
    const source = readRightPanelSource();

    expect(source).not.toContain('shadow-[var(--shadow-soft)]');
    expect(source).not.toContain('bg-[var(--color-app-bg)]');
    expect(source).not.toContain('Panel className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden"');
  });

  it('uses an integrated workspace surface instead of an inner workspace card', () => {
    const source = readRightPanelSource();

    expect(source).toContain('data-testid="right-workspace-panel"');
    expect(source).toContain('data-testid="right-workspace-panel-header"');
    expect(source).toContain('data-testid="right-workspace-panel-content"');
    expect(source).toContain('bg-[var(--color-surface)]');
    expect(source).not.toMatch(/<Panel(?:\s|>)/);
  });
});
