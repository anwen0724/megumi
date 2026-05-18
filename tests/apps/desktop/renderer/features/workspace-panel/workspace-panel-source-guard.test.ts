// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('workspace panel source guard', () => {
  it('keeps workspace panel scoped to workspace tabs and avoids direct renderer filesystem access', () => {
    const rightPanel = readSource('apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx');
    const filesTab = readSource('apps/desktop/src/renderer/features/workspace-panel/components/FilesPanelTab.tsx');
    const workspaceFilesStore = readSource('apps/desktop/src/renderer/entities/workspace-files/store.ts');
    const combined = `${rightPanel}\n${filesTab}\n${workspaceFilesStore}`;

    expect(rightPanel).not.toContain('TasksPanelTab');
    expect(rightPanel).not.toMatch(/label:\s*['"]Tasks['"]/);
    expect(rightPanel).not.toMatch(/label:\s*['"]Run['"]/);
    expect(combined).not.toMatch(/from ['"]electron['"]/);
    expect(combined).not.toMatch(/from ['"]node:fs['"]|from ['"]fs['"]|require\(['"]fs['"]\)/);
    expect(combined).not.toMatch(/workspacePath=/);
  });
});
