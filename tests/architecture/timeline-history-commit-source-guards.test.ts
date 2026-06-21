// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function walk(directory: string): string[] {
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(fullPath));
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) {
      entries.push(fullPath);
    }
  }
  return entries;
}

function sourceUnder(relativeDirectory: string): string {
  return walk(join(ROOT, relativeDirectory))
    .map((filePath) => readFileSync(filePath, 'utf8'))
    .join('\n');
}

describe('timeline history commit boundaries', () => {
  it('keeps the pure chat stream projection in packages/shared', () => {
    const shared = read('packages/shared/timeline/chat-stream-projection.ts');
    const rendererWrapper = read('apps/desktop/src/renderer/features/chat-stream/chat-stream-projection.ts');

    expect(shared).toContain('reduceChatStreamEvent');
    expect(shared).not.toContain('zustand');
    expect(shared).not.toContain('electron');
    expect(shared).not.toContain('window.megumi');
    expect(shared).not.toContain('apps/desktop');
    expect(rendererWrapper).toContain('@megumi/shared/timeline');
  });

  it('does not let main import renderer chat-stream projection code', () => {
    const source = read('apps/desktop/src/main/projections/timeline/timeline-history-commit-projector.service.ts');

    expect(source).toContain('@megumi/shared/timeline');
    expect(source).not.toContain('features/chat-stream');
    expect(source).not.toContain('apps/desktop/src/renderer');
  });

  it('keeps renderer timeline history on timeline repository instead of flat session messages', () => {
    const source = read('apps/desktop/src/main/services/session/session-run.service.ts');

    expect(source).toContain('timelineMessageRepository.listCommittedMessagesBySession(input)');
    expect(source).not.toContain('timelineMessagesFromPersistedMessages');
  });

  it('hydrates renderer history into chat-stream canonical state instead of old flat chat messages', () => {
    const source = read('apps/desktop/src/renderer/features/session-history/use-session-history-hydration.ts');

    expect(source).toContain('session.timeline.list');
    expect(source).toContain('hydrateCommittedMessages');
    expect(source).not.toContain('timelineMessagesFromPersistedMessages');
    expect(source).not.toContain('chatStore.setMessages(messages)');
  });

  it('keeps renderer history away from active path and retry recovery persistence', () => {
    const source = sourceUnder('apps/desktop/src/renderer');

    for (const forbidden of [
      'Session' + 'ActivePathRepository',
      'session_' + 'source_entries',
      'session_' + 'retry_attempts',
      'session_' + 'interrupted_run_markers',
      'mark' + 'InterruptedRuns(',
      'classify' + 'AutomaticModelStepRetry(',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('keeps persistence failure out of timeline answer/process blocks', () => {
    const source = read('apps/desktop/src/main/projections/timeline/timeline-history-commit-projector.service.ts');

    expect(source).toContain('recordCommitDiagnostic');
    expect(source).not.toContain('AnswerTextBlock');
    expect(source).not.toContain('ProcessDisclosureBlock');
    expect(source).not.toContain('assistant.text.delta');
  });
});
