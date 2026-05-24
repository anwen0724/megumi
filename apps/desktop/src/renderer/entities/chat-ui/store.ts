import { create } from 'zustand';

export type AgentRunStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

interface ChatUiState {
  agentStatus: AgentRunStatus;
  lastError: string | null;
  setAgentStatus: (status: AgentRunStatus) => void;
  setLastError: (error: string | null) => void;
}

export const useChatUiStore = create<ChatUiState>((set) => ({
  agentStatus: 'idle',
  lastError: null,
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setLastError: (lastError) => set({ lastError }),
}));
