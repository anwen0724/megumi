import type { RecoveryRepository } from '@megumi/db';
import type {
  CancelRequest,
  RecoverableRunSummary,
  ResumeRequest,
  RetryRequest,
} from '@megumi/shared/recovery-contracts';
import {
  CancelRequestSchema,
  ResumeRequestSchema,
  RetryRequestSchema,
} from '@megumi/shared/recovery-contracts';

export interface AgentRecoveryIds {
  resumeRequestId(): string;
  cancelRequestId(): string;
  retryRequestId(): string;
}

export interface CreateAgentRecoveryServiceOptions {
  repository: RecoveryRepository;
  clock: () => Date;
  ids: AgentRecoveryIds;
  listRecoverableRuns: () => RecoverableRunSummary[];
}

export interface AgentRecoveryService {
  listRecoverableRuns(): RecoverableRunSummary[];
  resumeRun(payload: Omit<ResumeRequest, 'resumeRequestId' | 'createdAt'>): ResumeRequest;
  cancelRun(payload: Omit<CancelRequest, 'cancelRequestId' | 'createdAt'>): CancelRequest;
  retryRun(payload: Omit<RetryRequest, 'retryRequestId' | 'createdAt'>): RetryRequest;
}

export function createAgentRecoveryService(options: CreateAgentRecoveryServiceOptions): AgentRecoveryService {
  return {
    listRecoverableRuns: () => options.listRecoverableRuns(),
    resumeRun: (payload) => {
      const request = ResumeRequestSchema.parse({
        ...payload,
        resumeRequestId: options.ids.resumeRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveResumeRequest(request);
    },
    cancelRun: (payload) => {
      const request = CancelRequestSchema.parse({
        ...payload,
        cancelRequestId: options.ids.cancelRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveCancelRequest(request);
    },
    retryRun: (payload) => {
      const request = RetryRequestSchema.parse({
        ...payload,
        retryRequestId: options.ids.retryRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveRetryRequest(request);
    },
  };
}
