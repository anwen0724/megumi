// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const CHAT_STREAM_DATA_LAYER_FILES = [
  'apps/desktop/src/renderer/features/chat-stream/chat-stream-dispatcher.ts',
  'apps/desktop/src/renderer/features/chat-stream/chat-stream-buffer.ts',
  'apps/desktop/src/renderer/features/chat-stream/chat-stream-projection.ts',
  'apps/desktop/src/renderer/features/chat-stream/chat-stream-store.ts',
];

const CHAT_RENDERER_UI_FILES = [
  'apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx',
  'apps/desktop/src/renderer/features/chat/components/WorkspaceChangeFooter.tsx',
  'apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx',
];

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function rendererSource(paths: string[]): string {
  return paths.map((path) => read(path)).join('\n');
}

describe('renderer chat stream source guards', () => {
  it('keeps chat-stream data layer independent from React, Electron, and raw RuntimeEvent', () => {
    for (const file of CHAT_STREAM_DATA_LAYER_FILES) {
      const source = read(file);

      expect(source).not.toMatch(/from ['"]react['"]/);
      expect(source).not.toContain('React.');
      expect(source).not.toMatch(/from ['"]electron['"]/);
      expect(source).not.toContain('ipcRenderer');
      expect(source).not.toContain('BrowserWindow');
      expect(source).not.toContain('window.megumi');
      expect(source).not.toContain('/preload/');
      expect(source).not.toMatch(/from ['"][^'"]*\/preload(?:\/|['"])/);
      expect(source).not.toMatch(/from ['"](?:\.\.\/)+preload(?:\/|['"])/);
      expect(source).not.toContain('/main/');
      expect(source).not.toMatch(/from ['"][^'"]*\/main(?:\/|['"])/);
      expect(source).not.toMatch(/from ['"](?:\.\.\/)+main(?:\/|['"])/);
      expect(source).not.toContain('Electron.');
      expect(source).not.toContain('RuntimeEvent');
    }
  });

  it('keeps chat-stream data layer off the legacy streamingText path', () => {
    for (const file of CHAT_STREAM_DATA_LAYER_FILES) {
      const source = read(file);

      expect(source).not.toContain('streamingText');
      expect(source).not.toContain('commitStream');
      expect(source).not.toContain('appendStreamToken');
      expect(source).not.toContain('pendingToolCalls');
      expect(source).not.toContain('completedToolActivities');
      expect(source).not.toContain('TimelineMessageData');
      expect(source).not.toContain('answerRevealAllowedByRun');
      expect(source).not.toContain('bufferedStreamOutputsByRun');
    }
  });

  it('keeps raw runtime event dispatcher out of ChatStreamEvent projection ownership', () => {
    const source = read('apps/desktop/src/renderer/features/runtime-events/runtime-event-dispatcher.ts');

    expect(source).not.toContain('ChatStreamEvent');
    expect(source).not.toContain('dispatchChatStreamEvent');
    expect(source).not.toContain('ChatStreamEventSchema');
  });

  it('routes ChatTimeline live rendering through canonical chat-stream state', () => {
    const source = read('apps/desktop/src/renderer/features/chat/components/ChatTimeline.tsx');

    expect(source).toContain('useChatStreamStore');
    expect(source).toContain('chatStreamSessionKey');
    expect(source).toContain('canonicalMessages');
    expect(source).toContain('timelineMessages = canonicalMessages');
    expect(source).not.toContain('StreamingAssistantMessage');
    expect(source).not.toContain('streamingText');
    expect(source).not.toContain('TimelineMessageData');
    expect(source).not.toContain('bufferedStreamOutputsByRun');
    expect(source).not.toContain('answerRevealAllowedByRun');
  });

  it('keeps timeline history hydration out of old useChatStore message snapshots', () => {
    const source = read('apps/desktop/src/renderer/features/session-history/use-session-history-hydration.ts');

    expect(source).toContain('useChatStreamStore');
    expect(source).toContain('hydrateCommittedMessages');
    expect(source).not.toContain('timelineMessagesFromPersistedMessages');
  });

  it('keeps workspace change footer UI on V1 labels only', () => {
    const source = rendererSource(CHAT_RENDERER_UI_FILES);
    const forbiddenLabels = [
      'Restore',
      'Undo',
      'Dismiss',
      'Review',
      '审查',
      'Keep',
      'Accept',
    ];

    for (const label of forbiddenLabels) {
      expect(source).not.toContain(`>${label}<`);
      expect(source).not.toContain(`'${label}'`);
      expect(source).not.toContain(`"${label}"`);
      expect(source).not.toContain('`' + label + '`');
    }
    expect(source).toContain('打开');
    expect(source).toContain('撤销');
  });

  it('does not add a right workspace sidebar Changes view for workspace change footer V1', () => {
    const source = read('apps/desktop/src/renderer/shell/RightWorkspacePanel.tsx');

    expect(source).not.toContain('Changes');
    expect(source).not.toContain('changed files');
    expect(source).not.toContain('workspace changes');
    expect(source).not.toContain('变更');
  });
});
