import { create } from 'zustand';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
export type ApprovalScope = 'once' | 'session' | string;

export interface ApprovalRequest {
  approvalRequestId: string;
  permissionDecisionId?: string;
  runId: string;
  stepId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
  canonicalToolId?: string;
  sourceId?: string;
  namespace?: string;
  capabilities?: string[];
  sourceToolName?: string;
  riskLevel?: string;
  title?: string;
  status: ApprovalStatus;
  requestedScope: ApprovalScope;
  modelVisibleName?: string;
  toolName?: string;
  summary?: string;
  preview: { action?: string; targets?: unknown[] };
  createdAt: string;
  resolvedAt?: string;
}

export interface ApprovalState {
  approvalRequestsById: Record<string, ApprovalRequest>;
  upsertApprovalRequest(request: ApprovalRequest): void;
  markResolved(approvalRequestId: string, status: Exclude<ApprovalStatus, 'pending'>, resolvedAt: string): void;
  listByRun(runId: string): ApprovalRequest[];
  pendingApprovals(): ApprovalRequest[];
  reset(): void;
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  approvalRequestsById: {},
  upsertApprovalRequest: (request) => set((state) => ({
    approvalRequestsById: {
      ...state.approvalRequestsById,
      [request.approvalRequestId]: request,
    },
  })),
  markResolved: (approvalRequestId, status, resolvedAt) => set((state) => {
    const current = state.approvalRequestsById[approvalRequestId];
    if (!current) {
      return state;
    }
    return {
      approvalRequestsById: {
        ...state.approvalRequestsById,
        [approvalRequestId]: {
          ...current,
          status,
          resolvedAt,
        },
      },
    };
  }),
  pendingApprovals: () => Object.values(get().approvalRequestsById)
    .filter((request) => request.status === 'pending')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  listByRun: (runId) => Object.values(get().approvalRequestsById)
    .filter((request) => request.runId === runId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  reset: () => set({ approvalRequestsById: {} }),
}));
