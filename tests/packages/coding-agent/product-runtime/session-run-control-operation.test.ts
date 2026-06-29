// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { ActiveSessionMessageRunTracker, type RunRetryCoordinatorPort } from '@megumi/coding-agent/state';
import type { ChatStreamEventAdapter } from '@megumi/coding-agent/projections/chat-stream';
import { SessionRunControlOperation } from '@megumi/coding-agent/product-runtime';

describe('SessionRunControlOperation', () => {
  it('coordinates cancel retry rerun and startup cleanup through state owner ports', () => {
    const activeRuns = new ActiveSessionMessageRunTracker<ChatStreamEventAdapter>();
    const projection = { name: 'projection' } as unknown as ChatStreamEventAdapter;
    const appended: Array<{ event: RuntimeEvent; projection?: ChatStreamEventAdapter }> = [];
    const cancelledApprovalRunIds: string[] = [];
    const providerCancelled: string[] = [];
    const retryResult = {
      retryAttempt: 'retry-attempt',
      retryAttemptSourceEntry: 'retry-source',
      events: [runtimeEvent('run.retry.requested')],
    } as unknown as ReturnType<RunRetryCoordinatorPort['createManualRetryFromRun']>;
    const rerunResult = {
      branchMarker: 'branch-marker',
      branchMarkerSourceEntry: 'branch-source',
      seedMessage: 'message',
      retryAttempt: 'retry-attempt',
      retryAttemptSourceEntry: 'retry-source',
      events: [runtimeEvent('run.retry.requested')],
    } as unknown as ReturnType<RunRetryCoordinatorPort['createManualRerunFromUserMessage']>;
    let terminalCancelInput: unknown;
    let cleanupInput: unknown;
    activeRuns.register('request-1', {
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      projection,
    });
    const operation = new SessionRunControlOperation({
      clock: { now: () => '2026-06-29T12:00:00.000Z' },
      ids: { cancelRequestId: () => 'cancel-request-1' },
      activeRuns,
      modelCallProvider: {
        cancelModelCall(requestId) {
          providerCancelled.push(requestId);
          return true;
        },
      },
      terminalCoordinator: {
        cancelActiveSessionMessageRun(input) {
          terminalCancelInput = input;
          input.cancelPendingApprovalGroupsByRun?.(input.activeRun.runId);
          input.appendEvent?.(runtimeEvent('run.cancelled'));
          return { handled: true, shouldForgetActiveRun: true };
        },
        cleanupInterruptedRunsOnStartup(input) {
          cleanupInput = input;
          return { cleanedRunIds: ['run-1'] };
        },
      },
      retryCoordinator: {
        createManualRetryFromRun(input) {
          expect(input.runId).toBe('run-1');
          return retryResult;
        },
        createManualRerunFromUserMessage(input) {
          expect(input.messageId).toBe('message-1');
          return rerunResult;
        },
      },
      cancelPendingApprovalGroupsByRun(runId) {
        cancelledApprovalRunIds.push(runId);
      },
      appendEvent(event, eventProjection) {
        appended.push({ event, projection: eventProjection });
      },
    });

    expect(operation.cancelSessionMessage({ targetRequestId: 'request-1' })).toBe(true);
    expect(providerCancelled).toEqual(['request-1']);
    expect(terminalCancelInput).toMatchObject({
      targetRequestId: 'request-1',
      cancelRequestId: 'cancel-request-1',
      cancelledAt: '2026-06-29T12:00:00.000Z',
      providerCancelled: true,
      activeRun: { runId: 'run-1', sessionId: 'session-1', stepId: 'step-1' },
    });
    expect(cancelledApprovalRunIds).toEqual(['run-1']);
    expect(appended).toEqual([{
      event: expect.objectContaining({ eventType: 'run.cancelled' }),
      projection,
    }]);
    expect(activeRuns.get('request-1')).toBeUndefined();
    expect(operation.createManualRetryFromRun({
      requestId: 'retry-request-1',
      runId: 'run-1',
      createdAt: '2026-06-29T12:00:00.000Z',
    })).toBe(retryResult);
    expect(operation.createManualRerunFromUserMessage({
      requestId: 'rerun-request-1',
      sessionId: 'session-1',
      messageId: 'message-1',
      createdAt: '2026-06-29T12:00:00.000Z',
    })).toBe(rerunResult);
    expect(operation.cleanupInterruptedRunsOnStartup()).toEqual({ cleanedRunIds: ['run-1'] });
    expect(cleanupInput).toEqual({ cleanupAt: '2026-06-29T12:00:00.000Z' });
  });
});

function runtimeEvent(eventType: RuntimeEvent['eventType']): RuntimeEvent {
  return {
    eventId: 'event-1',
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence: 1,
    createdAt: '2026-06-29T12:00:00.000Z',
    schemaVersion: 1,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {},
  };
}
