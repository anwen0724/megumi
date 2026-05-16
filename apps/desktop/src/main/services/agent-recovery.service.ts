import type { AgentRecoveryRepository } from '@megumi/db';
import type {
  AgentCancelRequest,
  AgentRecoverableRunSummary,
  AgentResumeRequest,
  AgentRetryRequest,
} from '@megumi/shared/agent-recovery-contracts';
import {
  AgentCancelRequestSchema,
  AgentResumeRequestSchema,
  AgentRetryRequestSchema,
} from '@megumi/shared/agent-recovery-contracts';

export interface AgentRecoveryIds {
  resumeRequestId(): string;
  cancelRequestId(): string;
  retryRequestId(): string;
}

export interface CreateAgentRecoveryServiceOptions {
  repository: AgentRecoveryRepository;
  clock: () => Date;
  ids: AgentRecoveryIds;
  listRecoverableRuns: () => AgentRecoverableRunSummary[];
}

export interface AgentRecoveryService {
  listRecoverableRuns(): AgentRecoverableRunSummary[];
  resumeRun(payload: Omit<AgentResumeRequest, 'resumeRequestId' | 'createdAt'>): AgentResumeRequest;
  cancelRun(payload: Omit<AgentCancelRequest, 'cancelRequestId' | 'createdAt'>): AgentCancelRequest;
  retryRun(payload: Omit<AgentRetryRequest, 'retryRequestId' | 'createdAt'>): AgentRetryRequest;
}

export function createAgentRecoveryService(options: CreateAgentRecoveryServiceOptions): AgentRecoveryService {
  return {
    listRecoverableRuns: () => options.listRecoverableRuns(),
    resumeRun: (payload) => {
      const request = AgentResumeRequestSchema.parse({
        ...payload,
        resumeRequestId: options.ids.resumeRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveResumeRequest(request);
    },
    cancelRun: (payload) => {
      const request = AgentCancelRequestSchema.parse({
        ...payload,
        cancelRequestId: options.ids.cancelRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveCancelRequest(request);
    },
    retryRun: (payload) => {
      const request = AgentRetryRequestSchema.parse({
        ...payload,
        retryRequestId: options.ids.retryRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveRetryRequest(request);
    },
  };
}
