import type { AgentType, LocalAgentSession } from '@megumi/shared/agent-contracts';

interface CreateLocalAgentSessionInput {
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

export function createLocalAgentSession({
  id = createSessionId(),
  projectId,
  title = 'New session',
  agentType = 'free',
  now = new Date().toISOString(),
}: CreateLocalAgentSessionInput): LocalAgentSession {
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
