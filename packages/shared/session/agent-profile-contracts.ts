import type { IsoDateTime, SessionId, WorkspaceId } from '../primitives/ids';

export const AGENT_TYPES = ['analyst', 'architect', 'developer', 'reviewer', 'free'] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_LABELS: Record<AgentType, string> = {
  analyst: 'Analyst',
  architect: 'Architect',
  developer: 'Developer',
  reviewer: 'Reviewer',
  free: 'Free',
};

export const AGENT_DESCRIPTIONS: Record<AgentType, string> = {
  analyst: 'Research, requirements, and problem framing',
  architect: 'Architecture, design, and tradeoff analysis',
  developer: 'Implementation and debugging',
  reviewer: 'Review, verification, and risk checks',
  free: 'General-purpose agent session',
};

export interface LocalAgentSession {
  id: SessionId | string;
  projectId: WorkspaceId | string;
  agentType: AgentType;
  title: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

