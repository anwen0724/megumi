import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentRuntimeEvent } from '../../../src/app';
import { mapAgentRuntimeEventToRendererRuntimeEvent } from '../../../src/desktop/renderer-protocol/runtime/agent-runtime-event-to-renderer-runtime-event';
import { useRunStore } from '../../../src/ui/entities/run/store';
import { createProcessingDisclosureModel } from '../../../src/ui/features/chat/processing-disclosure';
import { dispatchRuntimeEvent } from '../../../src/ui/features/runtime-events/runtime-event-dispatcher';

function agentRuntimeEvent(type: string, payload: Record<string, unknown> = {}): AgentRuntimeEvent {
  return {
    type,
    occurredAt: '2026-06-19T00:00:01.000Z',
    runId: 'run-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    payload,
  };
}

describe('src/ui runtime disclosure desktop projection compatibility', () => {
  beforeEach(() => {
    useRunStore.getState().resetRuns();
  });

  it('builds processing disclosure entries from desktop-forwarded runtime events', () => {
    const events = [
      mapAgentRuntimeEventToRendererRuntimeEvent(agentRuntimeEvent('run.started'), { sequence: 1 }),
      mapAgentRuntimeEventToRendererRuntimeEvent(agentRuntimeEvent('context.ready', {
        included: 2,
      }), { sequence: 2 }),
      mapAgentRuntimeEventToRendererRuntimeEvent(agentRuntimeEvent('ai.message.completed'), { sequence: 3 }),
      mapAgentRuntimeEventToRendererRuntimeEvent(agentRuntimeEvent('run.status.changed', {
        status: 'completed',
        requestId: 'request-1',
      }), { sequence: 4 }),
    ];

    for (const event of events) {
      if (event) dispatchRuntimeEvent(event);
    }

    const state = useRunStore.getState();
    const run = state.runs['run-1'];
    const model = createProcessingDisclosureModel({
      run,
      events: state.eventsByRun['run-1'] ?? [],
      now: new Date('2026-06-19T00:00:03.000Z'),
    });

    expect(model).toEqual(expect.objectContaining({
      status: 'completed',
      statusLabel: '已处理',
    }));
    expect(model?.completedEntries.map((entry) => entry.label)).toContain('已更新有效上下文');
    expect(model?.completedEntries.map((entry) => entry.label)).toContain('运行已完成');
  });
});
