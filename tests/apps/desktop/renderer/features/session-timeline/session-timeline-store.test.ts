import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyEvent } from '@megumi/product/host';
import {
  sessionTimelineKey,
  useSessionTimelineStore,
} from '../../../../../../apps/desktop/src/renderer/features/session-timeline/session-timeline-store';

describe('Session Timeline store', () => {
  beforeEach(() => useSessionTimelineStore.getState().reset());

  it('isolates Sessions and ignores a repeated Event identity', () => {
    const event = runtimeEvent('run.started', {}, 1);
    useSessionTimelineStore.getState().applyRuntimeEvent('project:1', event);
    useSessionTimelineStore.getState().applyRuntimeEvent('project:1', event);

    const state = useSessionTimelineStore.getState();
    const session = state.sessions[sessionTimelineKey('project:1', 'session:1')];
    expect(Object.keys(state.sessions)).toEqual(['project:1:session:1']);
    expect(session?.messages).toHaveLength(1);
    expect(session?.lastSequence).toBe(1);
    expect(session?.runStatusById['run:1']).toBe('running');
  });

  it('settles only the matching Run status', () => {
    useSessionTimelineStore.getState().applyRuntimeEvent('project:1', runtimeEvent('run.started', {}, 1));
    useSessionTimelineStore.getState().applyRuntimeEvent('project:1', runtimeEvent(
      'run.ended',
      { status: 'completed' },
      2,
    ));

    const session = useSessionTimelineStore.getState().sessions['project:1:session:1'];
    expect(session?.runStatusById).toEqual({ 'run:1': 'completed' });
  });
});

function runtimeEvent(
  type: AnyEvent['type'],
  payload: Record<string, unknown>,
  sequence: number,
): AnyEvent {
  return {
    id: `event:${sequence}`,
    type,
    payload,
    sessionId: 'session:1',
    executionId: 'run:1',
    sequence,
    createdAt: `2026-07-19T00:00:0${sequence}.000Z`,
  } as AnyEvent;
}
