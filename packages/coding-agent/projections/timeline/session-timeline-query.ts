/*
 * Projects the active Session path into the stable Timeline model consumed by
 * product hosts. Session storage and Workspace footer facts remain hidden.
 */
import type { SessionMessageWithAttachments, SessionService } from '../../session';
import type { WorkspaceChangeFooterProjectorService } from '../workspace/workspace-change-footer-projector';
import type { TimelineMessage } from './timeline-message-blocks';

export interface SessionTimelineQueryRequest {
  workspace_id: string;
  session_id: string;
  run_id?: string;
}

export interface SessionTimelineQueryResult {
  messages: TimelineMessage[];
  diagnostics: Array<{ messageId: string; code: string; message: string }>;
}

export interface SessionTimelineQuery {
  listSessionTimeline(request: SessionTimelineQueryRequest): SessionTimelineQueryResult;
}

export function createSessionTimelineQuery(input: {
  sessionService: Pick<SessionService, 'getActiveConversationHistory'>;
  workspaceChangeFooterProjector?: Pick<WorkspaceChangeFooterProjectorService, 'projectRunFooter'>;
}): SessionTimelineQuery {
  return {
    listSessionTimeline(request) {
      const result = input.sessionService.getActiveConversationHistory({
        session_id: request.session_id,
        ...(request.run_id ? { run_id: request.run_id } : {}),
      });
      if (result.status === 'failed') {
        return { messages: [], diagnostics: [] };
      }

      const messages = request.run_id
        ? result.messages.filter((item) => item.message.run_id === request.run_id)
        : result.messages;
      return {
        messages: projectSessionTimelineMessages({
          projectId: request.workspace_id,
          messages,
          workspaceChangeFooterProjector: input.workspaceChangeFooterProjector,
        }),
        diagnostics: [],
      };
    },
  };
}

export function projectSessionTimelineMessages(input: {
  projectId: string;
  messages: SessionMessageWithAttachments[];
  workspaceChangeFooterProjector?: Pick<WorkspaceChangeFooterProjectorService, 'projectRunFooter'>;
}): TimelineMessage[] {
  return input.messages.map((item): TimelineMessage => {
    const message = item.message;
    const createdAt = message.created_at;
    if (message.role === 'assistant') {
      const runId = message.run_id ?? `run:${message.message_id}`;
      const workspaceChangeFooter = input.workspaceChangeFooterProjector?.projectRunFooter(runId);
      return {
        messageId: message.message_id,
        role: 'assistant',
        projectId: input.projectId,
        sessionId: message.session_id,
        runId,
        createdAt,
        ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
        ...(workspaceChangeFooter ? { workspaceChangeFooter } : {}),
        blocks: [{
          blockId: `answer:${message.message_id}`,
          kind: 'answer_text',
          runId,
          textId: `text:${message.message_id}`,
          status: 'completed',
          text: message.content_text,
          format: 'markdown',
          createdAt,
          ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
        }],
      };
    }

    return {
      messageId: message.message_id,
      role: 'user',
      projectId: input.projectId,
      sessionId: message.session_id,
      ...(message.run_id ? { runId: message.run_id } : {}),
      createdAt,
      ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
      blocks: [{
        blockId: `user-text:${message.message_id}`,
        kind: 'user_text',
        text: message.content_text,
        format: 'plain',
        createdAt,
        ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
      }],
    };
  });
}
