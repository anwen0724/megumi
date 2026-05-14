import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const legacySubscriptionName = ['on', 'Stream', 'Event'].join('');
const legacyEventTypeName = ['Chat', 'Stream', 'Event'].join('');

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('renderer runtime event source guards', () => {
  it('does not subscribe to chat-specific stream events in active renderer code', () => {
    const source = read('apps/desktop/src/renderer/features/chat/hooks/use-runtime-chat.ts');

    expect(source).not.toContain(legacySubscriptionName);
    expect(source).not.toContain(legacyEventTypeName);
    expect(source).toContain('runtime.onEvent');
    expect(source).toContain('RuntimeEvent');
  });

  it('does not route runtime chat state from natural-language status text', () => {
    const source = read('apps/desktop/src/renderer/features/chat/hooks/use-runtime-chat.ts');

    expect(source).not.toContain("event.type === 'completed'");
    expect(source).toContain("event.eventType === 'run.completed'");
    expect(source).toContain("event.eventType === 'assistant.output.delta'");
  });
});
