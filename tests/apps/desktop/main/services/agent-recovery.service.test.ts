import { describe, expect, it } from 'vitest';

import { createAgentRecoveryService } from '@megumi/desktop/main/services/agent-recovery.service';
import type { AgentRecoveryRepository } from '@megumi/db/repos/agent-recovery.repo';
import type {
  AgentCancelRequest,
  AgentCheckpoint,
  AgentRecoverableRunSummary,
  AgentResumeRequest,
  AgentRetryRequest,
  CheckpointRestoreRecord,
} from '@megumi/shared/agent-recovery-contracts';

function createRepository(): AgentRecoveryRepository {
  const checkpoints: AgentCheckpoint[] = [];
  const resumeRequests: AgentResumeRequest[] = [];
  const cancelRequests: AgentCancelRequest[] = [];
  const retryRequests: AgentRetryRequest[] = [];
  const restoreRecords: CheckpointRestoreRecord[] = [];

  return {
    saveCheckpoint: (checkpoint: AgentCheckpoint) => {
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    getCheckpoint: (checkpointId: string) => checkpoints.find((checkpoint) => checkpoint.checkpointId === checkpointId),
    listCheckpointsByRun: (runId: string) => checkpoints.filter((checkpoint) => checkpoint.runId === runId),
    getLatestCheckpointByRun: (runId: string) => checkpoints.filter((checkpoint) => checkpoint.runId === runId).at(-1),
    markCheckpointStatus: () => undefined,
    saveResumeRequest: (request: AgentResumeRequest) => {
      resumeRequests.push(request);
      return request;
    },
    listResumeRequestsByRun: () => resumeRequests,
    saveCancelRequest: (request: AgentCancelRequest) => {
      cancelRequests.push(request);
      return request;
    },
    listCancelRequestsByRun: () => cancelRequests,
    saveRetryRequest: (request: AgentRetryRequest) => {
      retryRequests.push(request);
      return request;
    },
    listRetryRequestsByRun: () => retryRequests,
    saveRestoreRecord: (record: CheckpointRestoreRecord) => {
      restoreRecords.push(record);
      return record;
    },
    listRestoreRecordsByRun: () => restoreRecords,
  } as unknown as AgentRecoveryRepository;
}

describe('AgentRecoveryService', () => {
  it('lists recoverable runs from provider callback', () => {
    const service = createAgentRecoveryService({
      repository: createRepository(),
      clock: () => new Date('2026-05-16T10:00:00.000Z'),
      ids: {
        resumeRequestId: () => 'resume_request_123',
        cancelRequestId: () => 'cancel_request_123',
        retryRequestId: () => 'retry_request_123',
      },
      listRecoverableRuns: () => [{
        runId: 'run_123',
        sessionId: 'session_123',
        status: 'waiting_for_approval',
        reason: 'waiting_for_approval',
        latestCheckpointId: 'checkpoint_123',
      } satisfies AgentRecoverableRunSummary],
    });

    expect(service.listRecoverableRuns()).toHaveLength(1);
  });

  it('persists resume cancel and retry requests', () => {
    const repository = createRepository();
    const service = createAgentRecoveryService({
      repository,
      clock: () => new Date('2026-05-16T10:00:00.000Z'),
      ids: {
        resumeRequestId: () => 'resume_request_123',
        cancelRequestId: () => 'cancel_request_123',
        retryRequestId: () => 'retry_request_123',
      },
      listRecoverableRuns: () => [],
    });

    expect(service.resumeRun({
      runId: 'run_123',
      checkpointId: 'checkpoint_123',
      requestedBy: 'user',
      reason: 'user_requested',
      resumeMode: 'from_checkpoint',
    }).resumeRequestId).toBe('resume_request_123');

    expect(service.cancelRun({
      runId: 'run_123',
      requestedBy: 'user',
      reason: 'user_requested',
      scope: 'run',
    }).cancelRequestId).toBe('cancel_request_123');

    expect(service.retryRun({
      runId: 'run_123',
      requestedBy: 'user',
      retryKind: 'run',
      reason: 'runtime_retryable_error',
    }).retryRequestId).toBe('retry_request_123');
  });
});
