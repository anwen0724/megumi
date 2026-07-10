/* Stores the Agent switcher as a UI-only preference, not Session product state. */
import { create } from 'zustand';

export type AgentType = 'developer' | 'analyst' | 'architect' | 'reviewer' | 'free';

export const useAgentPreferenceStore = create<{
  activeAgentType: AgentType;
  setActiveAgentType(type: AgentType): void;
}>((set) => ({
  activeAgentType: 'free',
  setActiveAgentType: (activeAgentType) => set({ activeAgentType }),
}));
