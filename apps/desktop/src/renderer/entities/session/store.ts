import { create } from 'zustand';
import type { AgentType } from '@megumi/shared/session';
import { createLocalSession, type LocalRendererSession } from './session-factory';

interface CreateLocalSessionInput {
  projectId: string;
  title?: string;
  agentType?: AgentType;
}

interface SessionState {
  sessions: LocalRendererSession[];
  activeSessionId: string | null;
  activeAgentType: AgentType;
  newSessionDraftTargetProjectId: string | null;
  setSessions: (sessions: LocalRendererSession[]) => void;
  addSession: (session: LocalRendererSession) => void;
  upsertSession: (session: LocalRendererSession) => void;
  createLocalSession: (input: CreateLocalSessionInput) => LocalRendererSession;
  setActiveSession: (id: string | null) => void;
  setActiveAgentType: (type: AgentType) => void;
  startNewSessionDraft: (projectId: string | null) => void;
  setNewSessionDraftTargetProject: (projectId: string | null) => void;
  updateSession: (id: string, data: Partial<LocalRendererSession>) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeAgentType: 'free',
  newSessionDraftTargetProjectId: null,
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions],
  })),
  upsertSession: (session) => set((state) => {
    const existing = state.sessions.some((candidate) => candidate.id === session.id);
    return {
      sessions: existing
        ? state.sessions.map((candidate) => candidate.id === session.id ? session : candidate)
        : [session, ...state.sessions],
    };
  }),
  createLocalSession: (input) => {
    const session = createLocalSession({
      ...input,
      agentType: input.agentType ?? get().activeAgentType,
    });

    set((state) => ({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id,
      activeAgentType: session.agentType,
      newSessionDraftTargetProjectId: null,
    }));

    return session;
  },
  setActiveSession: (id) => set({
    activeSessionId: id,
    ...(id ? { newSessionDraftTargetProjectId: null } : {}),
  }),
  setActiveAgentType: (type) => set({ activeAgentType: type }),
  startNewSessionDraft: (projectId) => set({
    activeSessionId: null,
    newSessionDraftTargetProjectId: projectId,
  }),
  setNewSessionDraftTargetProject: (projectId) => set({
    newSessionDraftTargetProjectId: projectId,
  }),
  updateSession: (id, data) => set((state) => ({
    sessions: state.sessions.map((session) =>
      session.id === id ? { ...session, ...data, updatedAt: new Date().toISOString() } : session
    ),
  })),
}));

