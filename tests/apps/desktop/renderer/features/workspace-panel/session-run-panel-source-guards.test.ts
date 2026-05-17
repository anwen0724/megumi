// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('session run panel source guards', () => {
  it('does not keep workspace-state as the session run panel data source', () => {
    const tasksPanel = source('apps/desktop/src/renderer/features/workspace-panel/components/TasksPanelTab.tsx');
    const memoryPanel = source('apps/desktop/src/renderer/features/workspace-panel/components/MemoryPanelTab.tsx');

    expect(tasksPanel).toContain('useRunStore');
    expect(tasksPanel).not.toContain('useWorkspaceStateStore');
    expect(memoryPanel).not.toContain('useWorkspaceStateStore');
  });

  it('does not keep mock or runtime-chat panel labels in active renderer source', () => {
    const targets = [
      'apps/desktop/src/renderer/features/workspace-panel/components/TasksPanelTab.tsx',
      'apps/desktop/src/renderer/features/workspace-panel/components/MemoryPanelTab.tsx',
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
    ];

    for (const target of targets) {
      const text = source(target);
      expect(text).not.toContain('Mock agent run');
      expect(text).not.toContain('Runtime chat request');
      expect(text).not.toContain('beginRuntimeChat');
      expect(text).not.toContain('completeRuntimeChat');
      expect(text).not.toContain('failRuntimeChat');
    }
  });
});
