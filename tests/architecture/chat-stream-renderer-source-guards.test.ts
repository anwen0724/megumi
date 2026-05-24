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

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
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
    expect(source).not.toContain('StreamingAssistantMessage');
    expect(source).not.toContain('streamingText');
    expect(source).not.toContain('bufferedStreamOutputsByRun');
    expect(source).not.toContain('answerRevealAllowedByRun');
  });

  it('keeps timeline history hydration out of old useChatStore message snapshots', () => {
    const source = read('apps/desktop/src/renderer/features/session-history/use-session-history-hydration.ts');

    expect(source).toContain('useChatStreamStore');
    expect(source).toContain('hydrateCommittedMessages');
    expect(source).not.toContain('timelineMessagesFromPersistedMessages');
  });
});
