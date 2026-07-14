import { create } from 'zustand';

export type AgentRunStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ChatComposerDraftImage {
  draftAttachmentId: string;
  name: string;
  declaredMimeType?: string;
  referenceId: string;
  previewDataUrl: string;
}

export interface ChatComposerDraft {
  text: string;
  images: ChatComposerDraftImage[];
}

interface ChatUiSessionState {
  agentStatus: AgentRunStatus;
  lastError: string | null;
}

interface ChatUiState {
  activeSessionId: string | null;
  agentStatus: AgentRunStatus;
  lastError: string | null;
  composerDraft: ChatComposerDraft;
  sessionStates: Record<string, ChatUiSessionState>;
  setActiveSession: (sessionId: string | null) => void;
  setAgentStatus: (status: AgentRunStatus, sessionId?: string | null) => void;
  setLastError: (error: string | null, sessionId?: string | null) => void;
  setComposerDraft: (draft: ChatComposerDraft) => void;
}

export const useChatUiStore = create<ChatUiState>((set) => ({
  activeSessionId: null,
  agentStatus: 'idle',
  lastError: null,
  composerDraft: { text: '', images: [] },
  sessionStates: {},
  setActiveSession: (activeSessionId) => set((state) => {
    if (!activeSessionId) {
      return {
        activeSessionId: null,
        agentStatus: 'idle',
        lastError: null,
      };
    }

    const sessionState = state.sessionStates[activeSessionId] ?? {
      agentStatus: 'idle',
      lastError: null,
    };

    return {
      activeSessionId,
      agentStatus: sessionState.agentStatus,
      lastError: sessionState.lastError,
    };
  }),
  setAgentStatus: (agentStatus, sessionId) => set((state) => {
    const targetSessionId = sessionId ?? state.activeSessionId;
    if (!targetSessionId) {
      return { agentStatus };
    }

    const current = state.sessionStates[targetSessionId] ?? {
      agentStatus: 'idle',
      lastError: null,
    };
    const nextSessionState = {
      ...current,
      agentStatus,
    };

    return {
      sessionStates: {
        ...state.sessionStates,
        [targetSessionId]: nextSessionState,
      },
      ...(targetSessionId === state.activeSessionId ? {
        agentStatus,
        lastError: nextSessionState.lastError,
      } : {}),
    };
  }),
  setLastError: (lastError, sessionId) => set((state) => {
    const targetSessionId = sessionId ?? state.activeSessionId;
    if (!targetSessionId) {
      return { lastError };
    }

    const current = state.sessionStates[targetSessionId] ?? {
      agentStatus: 'idle',
      lastError: null,
    };
    const nextSessionState = {
      ...current,
      lastError,
    };

    return {
      sessionStates: {
        ...state.sessionStates,
        [targetSessionId]: nextSessionState,
      },
      ...(targetSessionId === state.activeSessionId ? {
        agentStatus: nextSessionState.agentStatus,
        lastError,
      } : {}),
    };
  }),
  setComposerDraft: (composerDraft) => set({ composerDraft }),
}));
