import { create } from 'zustand';
import type { AgentType } from '@megumi/shared/agent-contracts';
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
  setSessions: (sessions: LocalRendererSession[]) => void;
  addSession: (session: LocalRendererSession) => void;
  createLocalSession: (input: CreateLocalSessionInput) => LocalRendererSession;
  setActiveSession: (id: string | null) => void;
  setActiveAgentType: (type: AgentType) => void;
  updateSession: (id: string, data: Partial<LocalRendererSession>) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeAgentType: 'free',
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions],
  })),
  createLocalSession: (input) => {
    const session = createLocalSession({
      ...input,
      agentType: input.agentType ?? get().activeAgentType,
    });

    set((state) => ({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id,
      activeAgentType: session.agentType,
    }));

    return session;
  },
  setActiveSession: (id) => set({ activeSessionId: id }),
  setActiveAgentType: (type) => set({ activeAgentType: type }),
  updateSession: (id, data) => set((state) => ({
    sessions: state.sessions.map((session) =>
      session.id === id ? { ...session, ...data, updatedAt: new Date().toISOString() } : session
    ),
  })),
}));
