/*
 * Maps session and agent-run facts into host-facing chat UI DTOs.
 */
import type { AgentRun } from '../../coding-agent/agent-run';
import type { Session, SessionMessageWithAttachments } from '../../coding-agent/session';
import type {
  ChatRunUiDto,
  ChatSessionMessageUiDto,
  ChatSessionUiDto,
} from './chat-host-types';

export function toChatSessionUiDto(session: Session): ChatSessionUiDto {
  return {
    id: session.session_id,
    projectId: session.workspace_id,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}
export function toChatMessageUiDto(item: SessionMessageWithAttachments): ChatSessionMessageUiDto {
  const { message } = item;
  return {
    id: message.message_id,
    sessionId: message.session_id,
    ...(message.run_id ? { runId: message.run_id } : {}),
    role: message.role,
    text: message.content_text,
    createdAt: message.created_at,
  };
}

export function toChatRunUiDto(run: AgentRun): ChatRunUiDto {
  return {
    runId: run.run_id,
    sessionId: run.session_id,
    status: run.status,
    createdAt: run.created_at,
    ...(run.completed_at ? { completedAt: run.completed_at } : {}),
  };
}
