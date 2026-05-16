import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentRecoveryStore,
  type AgentRecoveryApi,
} from '@megumi/desktop/renderer/entities/agent-recovery/store';
import type { AgentRecoverableRunSummary } from '@megumi/shared/agent-recovery-contracts';

describe('agent recovery renderer store', () => {
  let api: AgentRecoveryApi;

  beforeEach(() => {
    api = {
      listRecoverableRuns: vi.fn(async () => ({
        runs: [{
          runId: 'run_123',
          sessionId: 'session_123',
          status: 'waiting_for_approval',
          reason: 'waiting_for_approval',
          latestCheckpointId: 'checkpoint_123',
          preview: 'Waiting for approval.',
        } satisfies AgentRecoverableRunSummary],
      })),
      resume: vi.fn(async (payload) => ({
        request: {
          ...payload,
          resumeRequestId: 'resume_request_123',
          createdAt: '2026-05-16T10:00:00.000Z',
        },
      })),
      cancel: vi.fn(async (payload) => ({
        request: {
          ...payload,
          cancelRequestId: 'cancel_request_123',
          createdAt: '2026-05-16T10:00:00.000Z',
        },
      })),
      retry: vi.fn(async (payload) => ({
        request: {
          ...payload,
          retryRequestId: 'retry_request_123',
          createdAt: '2026-05-16T10:00:00.000Z',
        },
      })),
    };
  });

  it('loads recoverable runs', async () => {
    const store = createAgentRecoveryStore(api);

    await store.getState().loadRecoverableRuns();

    expect(store.getState().recoverableRuns).toHaveLength(1);
    expect(store.getState().status).toBe('ready');
  });

  it('sends resume cancel and retry requests', async () => {
    const store = createAgentRecoveryStore(api);

    await store.getState().resumeRun({
      runId: 'run_123',
      checkpointId: 'checkpoint_123',
      requestedBy: 'user',
      reason: 'manual_resume',
      resumeMode: 'from_checkpoint',
    });

    await store.getState().cancelRun({
      runId: 'run_123',
      requestedBy: 'user',
      reason: 'user_requested',
      scope: 'run',
    });

    await store.getState().retryRun({
      runId: 'run_123',
      requestedBy: 'runtime',
      retryKind: 'retry_run_from_checkpoint',
      reason: 'runtime_error',
    });

    expect(api.resume).toHaveBeenCalledTimes(1);
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(api.retry).toHaveBeenCalledTimes(1);
    expect(store.getState().lastRequest?.runId).toBe('run_123');
  });
});
