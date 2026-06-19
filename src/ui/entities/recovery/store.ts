import { createStore } from 'zustand/vanilla';
import type { RecoverableRunSummary } from '@megumi/renderer-contracts/recovery';
import type {
  RecoverableRunListData,
  RunCancelData,
  RunCancelPayload,
  RunResumeData,
  RunResumePayload,
  RunRetryData,
  RunRetryPayload,
} from '@megumi/renderer-contracts/ipc';

export interface RecoveryApi {
  listRecoverableRuns(): Promise<RecoverableRunListData>;
  resume(payload: RunResumePayload): Promise<RunResumeData>;
  cancel(payload: RunCancelPayload): Promise<RunCancelData>;
  retry(payload: RunRetryPayload): Promise<RunRetryData>;
}

export type RecoveryStoreStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RecoveryStoreState {
  status: RecoveryStoreStatus;
  errorMessage?: string;
  recoverableRuns: RecoverableRunSummary[];
  lastRequest?: { kind: 'resume' | 'cancel' | 'retry'; runId: string };
  loadRecoverableRuns(): Promise<void>;
  resumeRun(payload: RunResumePayload): Promise<void>;
  cancelRun(payload: RunCancelPayload): Promise<void>;
  retryRun(payload: RunRetryPayload): Promise<void>;
}

export function createRecoveryStore(api: RecoveryApi) {
  return createStore<RecoveryStoreState>((set) => ({
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

