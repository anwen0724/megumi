export type AgentType = 'developer' | 'analyst' | 'architect' | 'reviewer' | 'free';

export interface LocalRendererSession {
  id: string;
  projectId: string;
  agentType: AgentType;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateLocalSessionInput {
  id?: string;
  projectId: string;
  title?: string;
  agentType?: AgentType;
  now?: string;
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `local-session-${Date.now().toString(36)}`;
}

export function createLocalSession({
  id = createSessionId(),
  projectId,
  title = 'New session',
  agentType = 'free',
  now = new Date().toISOString(),
}: CreateLocalSessionInput): LocalRendererSession {
  const normalizedTitle = title.trim() || 'New session';

  return {
    id,
    projectId,
    agentType,
    title: normalizedTitle,
    createdAt: now,
    updatedAt: now,
  };
}
