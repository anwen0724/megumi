// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function exists(relativePath: string): boolean {
  return existsSync(join(ROOT, relativePath));
}

describe('timeline finalization source guards', () => {
  it('removes legacy renderer chat runtime store files', () => {
    expect(exists('apps/desktop/src/renderer/entities/chat/store.ts')).toBe(false);
    expect(exists('apps/desktop/src/renderer/entities/chat/types.ts')).toBe(false);
    expect(exists('apps/desktop/src/renderer/entities/chat/index.ts')).toBe(false);
  });

  it('does not leave legacy chat runtime tokens in renderer source', () => {
    const rendererFiles = [
      'apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx',
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
      'apps/desktop/src/renderer/features/runtime-events/runtime-event-dispatcher.ts',
      'apps/desktop/src/renderer/features/session-history/use-session-history-hydration.ts',
      'apps/desktop/src/renderer/shell/AppShell.tsx',
    ];

    for (const file of rendererFiles) {
      const source = read(file);
      expect(source).not.toContain('streamingText');
      expect(source).not.toContain('commitStream');
      expect(source).not.toContain('appendStreamToken');
      expect(source).not.toContain('pendingToolCalls');
      expect(source).not.toContain('completedToolActivities');
      expect(source).not.toContain('TimelineMessageData');
    }
  });

  it('keeps old raw runtime labels out of the timeline UI', () => {
    const source = read('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx')
      + read('apps/desktop/src/renderer/features/chat/components/TimelineMessageBlocks.tsx')
      + read('apps/desktop/src/renderer/features/chat/components/ProcessDisclosureBlockView.tsx');

    expect(source).not.toContain('Answer started');
    expect(source).not.toContain('TOOL CALLS');
    expect(source).not.toContain('Legacy active tool calls');
    expect(source).not.toContain('Megumi is working');
  });
});
