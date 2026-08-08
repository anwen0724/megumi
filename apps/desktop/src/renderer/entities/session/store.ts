/* Stores canonical Product Host Session projections plus renderer selection state. */
import { create } from 'zustand';
import type { SessionDto } from '@megumi/product/host';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';
import { useChatUiStore } from '../chat-ui/store';

interface SessionState {
  sessions: SessionDto[];
  activeSessionId: string | null;
  newSessionDraftTargetProjectId: string | null;
  setSessions: (sessions: SessionDto[]) => void;
  loadSessions: () => Promise<void>;
  upsertSession: (session: SessionDto) => void;
  setActiveSession: (id: string | null) => void;
  startNewSessionDraft: (projectId: string | null) => void;
  setNewSessionDraftTargetProject: (projectId: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  newSessionDraftTargetProjectId: null,
  setSessions: (sessions) => set({ sessions }),
  /** Refreshes durable Session summaries without loading presentation history. */
  loadSessions: async () => {
    const result = await window.megumi.session.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionList, {}),
    );
    if (!result.ok) {
      useChatUiStore.getState().setLastError(getRuntimeIpcErrorMessage(result));
      return;
    }
    if (result.data.status === 'failed') {
      useChatUiStore.getState().setLastError(result.data.failure.message);
      return;
    }

    const sessions = result.data.sessions;
    set((state) => ({
      sessions,
      activeSessionId: state.activeSessionId
        && sessions.some((session) => session.id === state.activeSessionId)
        ? state.activeSessionId
        : null,
    }));
  },
  upsertSession: (session) => set((state) => ({
    sessions: state.sessions.some((candidate) => candidate.id === session.id)
      ? state.sessions.map((candidate) => candidate.id === session.id ? session : candidate)
      : [session, ...state.sessions],
  })),
  setActiveSession: (activeSessionId) => set({
    activeSessionId,
    ...(activeSessionId ? { newSessionDraftTargetProjectId: null } : {}),
  }),
  startNewSessionDraft: (projectId) => set({
    activeSessionId: null,
    newSessionDraftTargetProjectId: projectId,
  }),
  setNewSessionDraftTargetProject: (newSessionDraftTargetProjectId) => set({
    newSessionDraftTargetProjectId,
  }),
}));
