// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('main chat stream adapter source guards', () => {
  it('keeps ChatStreamEvent adapter in product projections and out of renderer', () => {
    const adapter = read('packages/coding-agent/projections/chat-stream/chat-stream-event-adapter.ts');

    expect(adapter).toContain('ChatStreamEventSink');
    expect(adapter).toContain('RuntimeEvent');
    expect(adapter).not.toMatch(/from ['"].*renderer/);
    expect(adapter).not.toMatch(/from ['"].*preload/);
    expect(adapter).not.toContain('window.');
    expect(adapter).not.toContain('ipcRenderer');
  });

  it('does not replace AgentLoopOperation runtime event stream with ChatStreamEvent', () => {
    const source = read('packages/coding-agent/product-runtime/agent-loop-operation.ts');

    expect(source).toContain('events: AsyncIterable<RuntimeEvent>');
    expect(source).toContain('chatStreamEventSink');
    expect(source).not.toContain('events: AsyncIterable<ChatStreamEvent>');
  });

  it('does not introduce assistant answer event naming in runtime adapter path', () => {
    for (const file of [
      'packages/coding-agent/projections/chat-stream/chat-stream-event-adapter.ts',
      'packages/coding-agent/product-runtime/agent-loop-operation.ts',
      'packages/ai/providers/openai-compatible/openai-compatible-provider-adapter.ts',
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
