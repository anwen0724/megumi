import { create } from 'zustand';
import type { ToolCall } from '@megumi/shared/tool-contracts';

export interface ToolCallState {
  toolCallsById: Record<string, ToolCall>;
  upsertToolCall(toolCall: ToolCall): void;
  listByRun(runId: string): ToolCall[];
  reset(): void;
}

export const useToolCallStore = create<ToolCallState>((set, get) => ({
  toolCallsById: {},
  upsertToolCall: (toolCall) => set((state) => ({
    toolCallsById: {
      ...state.toolCallsById,
      [toolCall.toolCallId]: toolCall,
    },
  })),
  listByRun: (runId) => Object.values(get().toolCallsById)
    .filter((toolCall) => toolCall.runId === runId)
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt)),
  reset: () => set({ toolCallsById: {} }),
}));
