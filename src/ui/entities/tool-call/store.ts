import { create } from 'zustand';
import type { ToolExecution } from '@megumi/renderer-contracts/tool';

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

