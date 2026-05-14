import { create } from 'zustand';
import type { TimelineMessageData } from './types';

type OptionalText = string | undefined;

export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'executing' | 'completed' | 'failed';
  result?: string;
  error?: OptionalText;
  duration?: string;
}

export interface CompletedToolActivity {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  duration: string;
  completedAt: string;
}

export type AgentRunStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ChatSnapshot {
  messages: TimelineMessageData[];
  streamingText: string;
  isStreaming: boolean;
  pendingToolCalls: PendingToolCall[];
  completedToolActivities: CompletedToolActivity[];
  agentStatus: AgentRunStatus;
  lastError: string | null;
}

interface ChatState extends ChatSnapshot {
  sessionSnapshots: Record<string, ChatSnapshot>;
  setMessages: (messages: TimelineMessageData[]) => void;
  addMessage: (message: TimelineMessageData) => void;
  appendStreamToken: (token: string) => void;
  commitStream: (message: TimelineMessageData) => void;
  clearStream: () => void;
  setAgentStatus: (status: AgentRunStatus) => void;
  setLastError: (error: string | null) => void;
  addToolCall: (toolCall: Omit<PendingToolCall, 'status'>) => void;
  completeToolCall: (
    id: string,
    result: { success: boolean; output: string; error?: OptionalText; duration?: string },
  ) => void;
  clearToolCalls: () => void;
  addCompletedToolActivity: (activity: CompletedToolActivity) => void;
  clearCompletedToolActivities: () => void;
  saveCurrentSessionSnapshot: (sessionId: string) => void;
  loadSessionSnapshot: (sessionId: string | null) => void;
  clearSessionSnapshots: () => void;
}

function createEmptyChatSnapshot(): ChatSnapshot {
  return {
    messages: [],
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    completedToolActivities: [],
    agentStatus: 'idle',
    lastError: null,
  };
}

function cloneSnapshot(snapshot: ChatSnapshot): ChatSnapshot {
  return {
    messages: [...snapshot.messages],
    streamingText: snapshot.streamingText,
    isStreaming: snapshot.isStreaming,
    pendingToolCalls: [...snapshot.pendingToolCalls],
    completedToolActivities: [...snapshot.completedToolActivities],
    agentStatus: snapshot.agentStatus,
    lastError: snapshot.lastError,
  };
}

function snapshotFromState(state: ChatState): ChatSnapshot {
  return cloneSnapshot({
    messages: state.messages,
    streamingText: state.streamingText,
    isStreaming: state.isStreaming,
    pendingToolCalls: state.pendingToolCalls,
    completedToolActivities: state.completedToolActivities,
    agentStatus: state.agentStatus,
    lastError: state.lastError,
  });
}

export const useChatStore = create<ChatState>((set) => ({
  ...createEmptyChatSnapshot(),
  sessionSnapshots: {},
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),
  appendStreamToken: (token) => set((state) => ({
    streamingText: state.streamingText + token,
    isStreaming: true,
    agentStatus: 'running',
  })),
  commitStream: (message) => set((state) => ({
    messages: [...state.messages, message],
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    agentStatus: 'idle',
    lastError: null,
  })),
  clearStream: () => set({
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    agentStatus: 'idle',
    lastError: null,
  }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setLastError: (lastError) => set({ lastError }),
  addToolCall: (toolCall) => set((state) => ({
    pendingToolCalls: [...state.pendingToolCalls, { ...toolCall, status: 'executing' }],
    agentStatus: 'running',
  })),
  completeToolCall: (id, result) => set((state) => ({
    pendingToolCalls: state.pendingToolCalls.map((toolCall) =>
      toolCall.id === id
        ? {
            ...toolCall,
            status: result.success ? 'completed' : 'failed',
            result: result.output,
            error: result.error,
            duration: result.duration,
          }
        : toolCall,
    ),
    agentStatus: result.success ? state.agentStatus : 'error',
    lastError: result.success ? state.lastError : result.error ?? 'Tool call failed',
  })),
  clearToolCalls: () => set({ pendingToolCalls: [] }),
  addCompletedToolActivity: (activity) => set((state) => ({
    completedToolActivities: [...state.completedToolActivities, activity],
  })),
  clearCompletedToolActivities: () => set({ completedToolActivities: [] }),
  saveCurrentSessionSnapshot: (sessionId) => set((state) => ({
    sessionSnapshots: {
      ...state.sessionSnapshots,
      [sessionId]: snapshotFromState(state),
    },
  })),
  loadSessionSnapshot: (sessionId) => set((state) => {
    const snapshot = sessionId ? state.sessionSnapshots[sessionId] : undefined;
    return cloneSnapshot(snapshot ?? createEmptyChatSnapshot());
  }),
  clearSessionSnapshots: () => set({ sessionSnapshots: {} }),
}));
