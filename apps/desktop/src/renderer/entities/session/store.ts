/* Stores canonical Product Host Session projections plus renderer selection state. */
import { create } from 'zustand';
import type { SessionDto } from '@megumi/product/host';

interface SessionState {
  sessions: SessionDto[];
  activeSessionId: string | null;
  newSessionDraftTargetProjectId: string | null;
  setSessions: (sessions: SessionDto[]) => void;
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
