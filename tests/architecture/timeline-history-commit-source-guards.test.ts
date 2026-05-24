// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('timeline history commit boundaries', () => {
  it('keeps the pure chat stream projection in packages/shared', () => {
    const shared = read('packages/shared/chat-stream-to-timeline-projection.ts');
    const rendererWrapper = read('apps/desktop/src/renderer/features/chat-stream/chat-stream-projection.ts');

    expect(shared).toContain('reduceChatStreamEvent');
    expect(shared).not.toContain('zustand');
    expect(shared).not.toContain('electron');
    expect(shared).not.toContain('window.megumi');
    expect(shared).not.toContain('apps/desktop');
    expect(rendererWrapper).toContain('@megumi/shared/chat-stream-to-timeline-projection');
  });

  it('does not let main import renderer chat-stream projection code', () => {
    const source = read('apps/desktop/src/main/services/timeline-history-commit-projector.service.ts');

    expect(source).toContain('@megumi/shared/chat-stream-to-timeline-projection');
    expect(source).not.toContain('features/chat-stream');
    expect(source).not.toContain('apps/desktop/src/renderer');
  });

  it('does not save new assistant history through old flat session message content', () => {
    const source = read('apps/desktop/src/main/services/session-run.service.ts');

    expect(source).not.toContain("role: 'assistant',\n      content: assistantContent");
    expect(source).not.toContain('assistantContent,');
  });

  it('hydrates renderer history into chat-stream canonical state instead of old flat chat messages', () => {
    const source = read('apps/desktop/src/renderer/features/session-history/use-session-history-hydration.ts');

    expect(source).toContain('session.timeline.list');
    expect(source).toContain('hydrateCommittedMessages');
    expect(source).not.toContain('timelineMessagesFromPersistedMessages');
    expect(source).not.toContain('chatStore.setMessages(messages)');
  });

  it('keeps persistence failure out of timeline answer/process blocks', () => {
    const source = read('apps/desktop/src/main/services/timeline-history-commit-projector.service.ts');

    expect(source).toContain('recordCommitDiagnostic');
    expect(source).not.toContain('AnswerTextBlock');
    expect(source).not.toContain('ProcessDisclosureBlock');
    expect(source).not.toContain('assistant.text.delta');
  });
});
