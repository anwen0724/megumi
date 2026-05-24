// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const legacySubscriptionName = ['on', 'Stream', 'Event'].join('');
const oldWindowChatNamespace = new RegExp([
  String.raw`\bwindow`,
  'megumi',
  String.raw`chat(?!Stream)\b`,
].join(String.raw`\.`));
const oldIpcChatNamespace = new RegExp([
  String.raw`\bIPC_CHANNELS`,
  String.raw`chat(?!Stream)\b`,
].join(String.raw`\.`));
const oldRuntimeChatHook = ['useRuntime', 'Chat'].join('');

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('renderer runtime event source guards', () => {
  it('allows chatStream protocol while keeping old runtime chat subscriptions out', () => {
    const source = read('apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts');

    expect(source).not.toContain(legacySubscriptionName);
    expect(source).not.toMatch(oldWindowChatNamespace);
    expect(source).not.toMatch(oldIpcChatNamespace);
    expect(source).not.toContain(oldRuntimeChatHook);
    expect(source).toContain('window.megumi.chatStream.onEvent');
    expect(source).toContain('dispatchChatStreamEvent');
    expect(source).toContain('runtime.onEvent');
    expect(source).toContain('RuntimeEvent');
  });

  it('does not route runtime chat state from natural-language status text', () => {
    const source = read('apps/desktop/src/renderer/features/runtime-events/runtime-event-dispatcher.ts');

    expect(source).not.toContain("event.type === 'completed'");
    expect(source).toContain("event.eventType === 'run.completed'");
    expect(source).toContain("event.eventType === 'assistant.output.delta'");
  });
});
