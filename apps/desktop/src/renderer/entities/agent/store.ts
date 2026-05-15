import { create } from 'zustand';
import type { AgentType, LocalAgentSession } from '@megumi/shared/agent-contracts';
import { createLocalAgentSession } from './session-factory';

interface CreateLocalSessionInput {
  projectId: string;
  title?: string;
  agentType?: AgentType;
}

interface AgentState {
  sessions: LocalAgentSession[];
  activeSessionId: string | null;
  activeAgentType: AgentType;
  setSessions: (sessions: LocalAgentSession[]) => void;
  addSession: (session: LocalAgentSession) => void;
  createLocalSession: (input: CreateLocalSessionInput) => LocalAgentSession;
  setActiveSession: (id: string | null) => void;
  setActiveAgentType: (type: AgentType) => void;
  updateSession: (id: string, data: Partial<LocalAgentSession>) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeAgentType: 'free',
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions],
  })),
  createLocalSession: (input) => {
    const session = createLocalAgentSession({
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
