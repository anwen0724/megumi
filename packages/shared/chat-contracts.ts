import type { IsoDateTime, MessageId, RunId, SessionId, WorkspaceId } from './ids';
import type { ModelId } from './model-contracts';
import type { ProviderId } from './provider-contracts';
import type { RuntimeContext } from './runtime-context';

export const CHAT_ROLES = ['system', 'user', 'assistant', 'tool'] as const;

export type ChatRole = (typeof CHAT_ROLES)[number];

export type ComposerMode = 'chat' | 'plan' | 'execute' | 'review';

export interface ChatMessage {
  id: MessageId | string;
  role: ChatRole;
  content: string;
  createdAt: IsoDateTime;
  name?: string;
  toolCallId?: string;
}

export interface ChatRuntimeContext {
  workspaceId?: WorkspaceId | string;
  workspaceLabel?: string;
  workspacePath?: string;
  sessionTitle?: string;
  composerMode?: ComposerMode;
}

export interface ChatRuntimeRequest {
  requestId: string;
  sessionId?: SessionId | string;
  providerId: ProviderId;
  modelId: ModelId | string;
  messages: ChatMessage[];
  context?: ChatRuntimeContext;
  runtimeContext?: RuntimeContext;
  createdAt: IsoDateTime;
}

export interface ChatTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
