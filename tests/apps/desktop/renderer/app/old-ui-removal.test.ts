// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');

const removedVisualFiles = [
  'apps/desktop/src/renderer/shell/TopBar.tsx',
  'apps/desktop/src/renderer/shell/MainWorkspace.tsx',
  'apps/desktop/src/renderer/shell/RightPanel.tsx',
  'apps/desktop/src/renderer/shell/FileTree.tsx',
  'apps/desktop/src/renderer/shell/ContextPanel.tsx',
  'apps/desktop/src/renderer/features/sessions/components/SessionSidebar.tsx',
  'apps/desktop/src/renderer/features/sessions/index.ts',
  'apps/desktop/src/renderer/features/chat/components/ChatView.tsx',
  'apps/desktop/src/renderer/features/chat/components/ChatInput.tsx',
  'apps/desktop/src/renderer/entities/message/MessageBubble.tsx',
  'apps/desktop/src/renderer/entities/message/index.ts',
  'apps/desktop/src/renderer/entities/tool-call/ToolCallCard.tsx',
  'apps/desktop/src/renderer/entities/tool-call/StreamingText.tsx',
  'apps/desktop/src/renderer/features/approvals/components/ApprovalDialog.tsx',
  'apps/desktop/src/renderer/features/chat/components/ApprovalStack.tsx',
  'apps/desktop/src/renderer/entities/approval/ApprovalCard.tsx',
  'apps/desktop/src/renderer/entities/approval/store.ts',
  'apps/desktop/src/renderer/entities/approval/index.ts',
  'apps/desktop/src/renderer/features/approvals/index.ts',
  'apps/desktop/src/renderer/features/approvals/store.ts',
];

const removedVisualTests = [
  'tests/apps/desktop/renderer/shell/RightPanel.test.tsx',
  'tests/apps/desktop/renderer/features/sessions/SessionSidebar.test.tsx',
  'tests/apps/desktop/renderer/features/chat/ChatView.test.tsx',
  'tests/apps/desktop/renderer/features/chat/ChatInput.test.tsx',
  'tests/apps/desktop/renderer/entities/message/MessageBubble.test.tsx',
  'tests/apps/desktop/renderer/entities/tool-call/ToolCallCard.test.tsx',
  'tests/apps/desktop/renderer/features/approvals/ApprovalDialog.test.tsx',
];

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('old visual UI removal', () => {
  it('deletes old visual source files', () => {
    for (const file of removedVisualFiles) {
      expect(existsSync(resolve(repoRoot, file)), file).toBe(false);
    }
  });

  it('deletes old visual tests', () => {
    for (const file of removedVisualTests) {
      expect(existsSync(resolve(repoRoot, file)), file).toBe(false);
    }
  });

  it('keeps the session timeline hook and removes old stream hooks', () => {
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/hooks/use-runtime-chat.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/hooks/use-ai-stream.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'apps/desktop/src/renderer/features/chat/hooks/use-agent-stream.ts'))).toBe(false);
  });

  it('does not export deleted visual components from barrels', () => {
    const chatIndex = readSource('apps/desktop/src/renderer/features/chat/index.ts');
    const toolCallIndex = readSource('apps/desktop/src/renderer/entities/tool-call/index.ts');

    expect(chatIndex).not.toContain('ChatView');
    expect(chatIndex).not.toContain('ChatInput');
    expect(toolCallIndex).not.toContain('ToolCallCard');
    expect(toolCallIndex).not.toContain('StreamingText');
  });
});
