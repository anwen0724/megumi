import { create } from 'zustand';

export type ToolExecutionStatus =
  | 'created'
  | 'awaitingApproval'
  | 'rejected'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ToolPolicyDecision {
  toolCallId?: string;
  runId?: string;
  source?: string;
  mode?: string;
  classifierLabel?: string;
  target?: unknown;
  capability?: string;
  sideEffect?: string;
  effectiveRiskLevel?: string;
  evaluatedAt?: string;
  decision: string;
  reason?: string;
  permissionDecisionId?: string;
}

export interface ToolExecution {
  toolExecutionId: string;
  toolCallId: string;
  runId: string;
  stepId?: string;
  toolName: string;
  modelVisibleName?: string;
  status: ToolExecutionStatus;
  requestedAt: string;
  input?: unknown;
  capabilities?: string[];
  riskLevel?: string;
  sideEffect?: string;
  startedAt?: string;
  completedAt?: string;
  approvalRequestId?: string;
  inputPreview?: unknown;
  policyDecision?: ToolPolicyDecision;
  resultPreview?: unknown;
  error?: { code?: string; message?: string; severity?: string; retryable?: boolean; source?: string };
}

export interface ToolCallState {
  toolCallsById: Record<string, ToolExecution>;
  upsertToolCall(toolExecution: ToolExecution): void;
  findByToolCallId(toolCallId: string): ToolExecution | undefined;
  listByRun(runId: string): ToolExecution[];
  reset(): void;
}

export const useToolCallStore = create<ToolCallState>((set, get) => ({
  toolCallsById: {},
  upsertToolCall: (toolExecution) => set((state) => ({
    toolCallsById: {
      ...state.toolCallsById,
      [toolExecution.toolExecutionId]: toolExecution,
    },
  })),
  findByToolCallId: (toolCallId) => Object.values(get().toolCallsById)
    .find((toolExecution) => toolExecution.toolCallId === toolCallId),
  listByRun: (runId) => Object.values(get().toolCallsById)
    .filter((toolCall) => toolCall.runId === runId)
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt)),
  reset: () => set({ toolCallsById: {} }),
}));
