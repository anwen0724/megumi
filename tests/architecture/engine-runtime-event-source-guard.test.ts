// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const NORMALIZE_RUNTIME_EVENT_PAYLOAD = ['normalize', 'Runtime', 'Event', 'Payload'].join('');
const NORMALIZED_RUNTIME_EVENT_PAYLOAD = ['Normalized', 'Runtime', 'Event', 'Payload'].join('');
const TOOL_EXECUTION_PREFIX = ['tool', 'execution'].join('_') + '.';
const TOOL_RESULT_FACTS_SUBMITTED = ['tool', 'result', 'facts'].join('_') + '.submitted';
const MODEL_CALL_FAILED = ['model', 'call'].join('_') + '.failed';
const CHAT_STREAM_EVENT = ['Chat', 'Stream', 'Event'].join('');
const CHAT_STREAM_CHANNEL = ['chat', 'stream:event'].join('-');
const CHAT_STREAM_BRIDGE = ['window', 'megumi', ['chat', 'Stream'].join('')].join('.');
const USE_CHAT_STREAM_STORE = ['use', 'Chat', 'Stream', 'Store'].join('');
const RUNTIME_EVENT_SINK = ['runtime', 'Event', 'Sink'].join('');
const RUNTIME_EVENT_BROADCASTER = ['Runtime', 'Event', 'Broadcaster'].join('');
const CREATE_RUNTIME_EVENT_BROADCASTER = ['create', 'Runtime', 'Event', 'Broadcaster'].join('');
const RUNTIME_EVENT_BROADCASTER_FILE = ['runtime', 'event', 'broadcaster'].join('-');

describe('Engine RuntimeEvent source boundary', () => {
  it('publishes formal RuntimeEvents through the bus without a dynamic normalization layer', () => {
    const runLoop = readSource('packages/engine/src/run-loop.ts');

    expect(runLoop).toContain('events.publish({');
    expect(runLoop).not.toContain(NORMALIZE_RUNTIME_EVENT_PAYLOAD);
    expect(runLoop).not.toContain(NORMALIZED_RUNTIME_EVENT_PAYLOAD);
    expect(runLoop).not.toContain('stringPayload(payload');
    expect(runLoop).not.toContain('toolResultKind(payload');
    expect(runLoop).not.toContain('approvalDecision(payload');
    expect(runLoop).not.toMatch(/emit\(type:\s*string,\s*payload/);
    expect(runLoop).not.toMatch(/createRuntimeEvent\(\s*type:\s*string/);
  });

  it('does not derive Engine RuntimeEvent types from internal operation names', () => {
    const runLoop = readSource('packages/engine/src/run-loop.ts');

    expect(runLoop).not.toContain('`model_call.${event.type}`');
    expect(runLoop).not.toContain('`tool_execution.${');
    expect(runLoop).not.toContain(TOOL_RESULT_FACTS_SUBMITTED);
    expect(runLoop).not.toContain(MODEL_CALL_FAILED);
  });

  it('does not restore the deleted ChatStream protocol or bridge', () => {
    const productionFiles = [
      'packages/projections/src/timeline/runtime-timeline.ts',
      'apps/desktop/src/main/ipc/handlers/chat.handler.ts',
      'apps/desktop/src/main/shell-composition/desktop-main-composition.ts',
      'apps/desktop/src/renderer/features/runtime-events/runtime-event-dispatcher.ts',
      'apps/desktop/src/renderer/features/runtime-timeline/runtime-timeline-store.ts',
      'apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts',
    ];

    for (const file of productionFiles) {
      const source = readSource(file);
      expect(source).not.toContain(CHAT_STREAM_EVENT);
      expect(source).not.toContain(CHAT_STREAM_CHANNEL);
      expect(source).not.toContain(CHAT_STREAM_BRIDGE);
      expect(source).not.toContain(USE_CHAT_STREAM_STORE);
    }
  });

  it('does not use a second runtime event UI live path', () => {
    const productionFiles = [
      'packages/engine/src/run-loop.ts',
      'apps/desktop/src/main/shell-composition/desktop-main-composition.ts',
      'apps/desktop/src/main/index.ts',
    ];

    for (const file of productionFiles) {
      const source = readSource(file);
      expect(source).not.toContain(RUNTIME_EVENT_SINK);
      expect(source).not.toContain(RUNTIME_EVENT_BROADCASTER);
      expect(source).not.toContain(CREATE_RUNTIME_EVENT_BROADCASTER);
      expect(source).not.toContain(RUNTIME_EVENT_BROADCASTER_FILE);
    }
  });

  it('does not filter active request runtime events by sequence in the chat hook', () => {
    const hook = readSource('apps/desktop/src/renderer/features/chat/hooks/use-session-timeline.ts');

    expect(hook).not.toContain('event.sequence <= lastSequence');
    expect(hook).not.toContain('processedSequences');
  });
});
