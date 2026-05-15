// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentLifecycleStore } from '@megumi/desktop/renderer/entities/agent-lifecycle/store';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

function event(eventType: RuntimeEvent['eventType'], sequence: number): RuntimeEvent {
  return {
    eventId: `event-${sequence}`,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    createdAt: '2026-05-15T00:00:00.000Z',
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: eventType === 'run.status.changed'
      ? { from: 'queued', to: 'running' }
      : {},
  } as RuntimeEvent;
}

describe('useAgentLifecycleStore', () => {
  beforeEach(() => {
    useAgentLifecycleStore.setState({
      sessions: [],
      runs: {},
      eventsByRun: {},
      activeRunId: null,
      lastError: null,
    });
  });

  it('stores sessions and run snapshots without replacing chat state', () => {
    const store = useAgentLifecycleStore.getState();

    store.setSessions([{
      sessionId: 'session-1',
      title: 'Lifecycle',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    }]);
    store.upsertRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Answer',
      status: 'queued',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(useAgentLifecycleStore.getState().sessions).toHaveLength(1);
    expect(useAgentLifecycleStore.getState().runs['run-1'].status).toBe('queued');
  });

  it('deduplicates lifecycle events by run sequence', () => {
    const store = useAgentLifecycleStore.getState();
    store.applyRuntimeEvent(event('run.started', 1));
    store.applyRuntimeEvent(event('run.started', 1));
    store.applyRuntimeEvent(event('run.status.changed', 2));

    expect(useAgentLifecycleStore.getState().eventsByRun['run-1'].map((item) => item.sequence)).toEqual([1, 2]);
    expect(useAgentLifecycleStore.getState().runs['run-1']).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      status: 'running',
    });
  });
});
