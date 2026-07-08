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

describe('Agent Run RuntimeEvent source boundary', () => {
  it('does not normalize internal event names into RuntimeEvent at service boundary', () => {
    const service = readSource('packages/coding-agent/agent-run/services/agent-run-service.ts');

    expect(service).not.toContain(NORMALIZE_RUNTIME_EVENT_PAYLOAD);
    expect(service).not.toContain(NORMALIZED_RUNTIME_EVENT_PAYLOAD);
    expect(service).not.toContain('stringPayload(payload');
    expect(service).not.toContain('toolResultKind(payload');
    expect(service).not.toContain('approvalDecision(payload');
    expect(service).not.toMatch(/emit\(type:\s*string,\s*payload/);
    expect(service).not.toMatch(/createRuntimeEvent\(\s*type:\s*string/);
  });

  it('does not emit agent-run runtime events using dynamic internal event names', () => {
    const orchestrator = readSource('packages/coding-agent/agent-run/core/run-orchestrator.ts');
    const service = readSource('packages/coding-agent/agent-run/services/agent-run-service.ts');

    expect(orchestrator).not.toContain('event_sink.emit(`model_call.${event.type}`');
    expect(orchestrator).not.toContain(TOOL_EXECUTION_PREFIX);
    expect(orchestrator).not.toContain(TOOL_RESULT_FACTS_SUBMITTED);
    expect(orchestrator).not.toContain(MODEL_CALL_FAILED);
    expect(service).not.toContain(TOOL_EXECUTION_PREFIX);
    expect(service).not.toContain(TOOL_RESULT_FACTS_SUBMITTED);
    expect(service).not.toContain(MODEL_CALL_FAILED);
  });

  it('does not restore the deleted ChatStream protocol or bridge', () => {
    const productionFiles = [
      'packages/coding-agent/projections/timeline/runtime-timeline-projection.ts',
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
      'packages/coding-agent/composition/compose-coding-agent-runtime.ts',
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
