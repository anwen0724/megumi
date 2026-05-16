import { createStore } from 'zustand/vanilla';
import type { AgentRecoverableRunSummary } from '@megumi/shared/agent-recovery-contracts';
import type {
  AgentRecoverableRunListData,
  AgentRunCancelData,
  AgentRunCancelPayload,
  AgentRunResumeData,
  AgentRunResumePayload,
  AgentRunRetryData,
  AgentRunRetryPayload,
} from '@megumi/shared/ipc-schemas';

export interface AgentRecoveryApi {
  listRecoverableRuns(): Promise<AgentRecoverableRunListData>;
  resume(payload: AgentRunResumePayload): Promise<AgentRunResumeData>;
  cancel(payload: AgentRunCancelPayload): Promise<AgentRunCancelData>;
  retry(payload: AgentRunRetryPayload): Promise<AgentRunRetryData>;
}

export type AgentRecoveryStoreStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AgentRecoveryStoreState {
  status: AgentRecoveryStoreStatus;
  errorMessage?: string;
  recoverableRuns: AgentRecoverableRunSummary[];
  lastRequest?: { kind: 'resume' | 'cancel' | 'retry'; runId: string };
  loadRecoverableRuns(): Promise<void>;
  resumeRun(payload: AgentRunResumePayload): Promise<void>;
  cancelRun(payload: AgentRunCancelPayload): Promise<void>;
  retryRun(payload: AgentRunRetryPayload): Promise<void>;
}

export function createAgentRecoveryStore(api: AgentRecoveryApi) {
  return createStore<AgentRecoveryStoreState>((set) => ({
    status: 'idle',
    recoverableRuns: [],
    loadRecoverableRuns: async () => {
      set({ status: 'loading', errorMessage: undefined });
      try {
        const data = await api.listRecoverableRuns();
        set({ status: 'ready', recoverableRuns: data.runs });
      } catch (error) {
        set({
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Failed to load recoverable runs.',
        });
      }
    },
    resumeRun: async (payload) => {
      await api.resume(payload);
      set({ lastRequest: { kind: 'resume', runId: payload.runId } });
    },
    cancelRun: async (payload) => {
      await api.cancel(payload);
      set({ lastRequest: { kind: 'cancel', runId: payload.runId } });
    },
    retryRun: async (payload) => {
      await api.retry(payload);
      set({ lastRequest: { kind: 'retry', runId: payload.runId } });
    },
  }));
}
