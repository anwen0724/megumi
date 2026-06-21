// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('main chat stream adapter source guards', () => {
  it('keeps ChatStreamEvent adapter in main and out of renderer', () => {
    const adapter = read('apps/desktop/src/main/projections/chat-stream/chat-stream-event-adapter.service.ts');

    expect(adapter).toContain('ChatStreamEventSink');
    expect(adapter).toContain('RuntimeEvent');
    expect(adapter).not.toMatch(/from ['"].*renderer/);
    expect(adapter).not.toMatch(/from ['"].*preload/);
    expect(adapter).not.toContain('window.');
    expect(adapter).not.toContain('ipcRenderer');
  });

  it('does not replace SessionRunService runtime event stream with ChatStreamEvent', () => {
    const source = read('apps/desktop/src/main/services/session/session-run.service.ts');

    expect(source).toContain('events: AsyncIterable<RuntimeEvent>');
    expect(source).toContain('chatStreamEventSink');
    expect(source).not.toContain('events: AsyncIterable<ChatStreamEvent>');
  });

  it('does not introduce assistant answer event naming in runtime adapter path', () => {
    for (const file of [
      'apps/desktop/src/main/projections/chat-stream/chat-stream-event-adapter.service.ts',
      'apps/desktop/src/main/services/session/session-run.service.ts',
      'packages/ai/providers/openai-compatible.ts',
    ]) {
      expect(read(file)).not.toContain('assistant.answer.');
    }
  });

  it('keeps renderer raw runtime event migration out of this plan', () => {
    const source = read('apps/desktop/src/renderer/features/runtime-events/runtime-event-dispatcher.ts');

    expect(source).toContain('RuntimeEvent');
    expect(source).not.toContain('ChatStreamEventSink');
    expect(source).not.toContain('chat-stream-event-adapter.service');
  });
});
