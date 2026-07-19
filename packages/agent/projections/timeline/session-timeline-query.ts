/*
 * Projects explicit Session semantic message variants into historical
 * Timeline DTOs. Runtime Events remain the source only while a Run is live.
 */
import {
  isLegacySessionMessage,
  sessionMessageText,
  type SessionAssistantReplyMessage,
  type SessionMessageWithAttachments,
  type SessionService,
} from '../../session';
import type { WorkspaceChangeFooterProjectorService } from '../workspace/workspace-change-footer-projector';
import type {
  AnswerTextStatus,
  ProcessDisclosureItem,
  TimelineAssistantMessage,
  TimelineMessage,
  TimelineUserMessage,
} from './timeline-message-blocks';

type AssistantReplyItem = SessionMessageWithAttachments & { message: SessionAssistantReplyMessage };

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
  isRunLive?: (runId: string) => boolean;
  workspaceChangeFooterProjector?: Pick<WorkspaceChangeFooterProjectorService, 'projectRunFooter'>;
}): SessionTimelineQuery {
  return {
    listSessionTimeline(request) {
      const result = input.sessionService.getActiveConversationHistory({
        session_id: request.session_id,
        ...(request.run_id ? { run_id: request.run_id } : {}),
      });
      if (result.status === 'failed') return { messages: [], diagnostics: [] };
      const projected = projectSessionTimelineMessages({
        projectId: request.workspace_id,
        messages: result.messages,
        ...(request.run_id ? { requestedRunId: request.run_id } : {}),
        ...(input.isRunLive ? { isRunLive: input.isRunLive } : {}),
        workspaceChangeFooterProjector: input.workspaceChangeFooterProjector,
      });
      return {
        messages: request.run_id
          ? projected.filter((message) => (
              (message.role === 'user' || message.role === 'assistant')
              && message.runId === request.run_id
            ))
          : projected,
        diagnostics: [],
      };
    },
  };
}

export function projectSessionTimelineMessages(input: {
  projectId: string;
  messages: SessionMessageWithAttachments[];
  requestedRunId?: string;
  isRunLive?: (runId: string) => boolean;
  workspaceChangeFooterProjector?: Pick<WorkspaceChangeFooterProjectorService, 'projectRunFooter'>;
}): TimelineMessage[] {
  const responseGroups = groupResponsesByRun(input.messages);
  const timeline: TimelineMessage[] = [];

  for (const item of input.messages) {
    if (item.message.message_kind !== 'user_message') continue;
    timeline.push(projectSessionTimelineUserMessage(
      input.projectId,
      item,
      item.active_path_order ?? timeline.length,
    ));
    const runId = item.message.run_id;
    if (!runId || input.isRunLive?.(runId)) continue;
    const group = responseGroups.get(runId) ?? [];
    timeline.push(projectAssistantRun(
      input.projectId,
      runId,
      item,
      group,
      group[0]?.active_path_order ?? (item.active_path_order ?? timeline.length) + 1,
      !input.requestedRunId || input.requestedRunId === runId
        ? input.workspaceChangeFooterProjector?.projectRunFooter(runId)
        : undefined,
    ));
  }
  return timeline;
}

function groupResponsesByRun(messages: SessionMessageWithAttachments[]): Map<string, SessionMessageWithAttachments[]> {
  const groups = new Map<string, SessionMessageWithAttachments[]>();
  for (const item of messages) {
    if (item.message.message_kind === 'user_message' || !item.message.run_id) continue;
    const group = groups.get(item.message.run_id) ?? [];
    group.push(item);
    groups.set(item.message.run_id, group);
  }
  return groups;
}

export function projectSessionTimelineUserMessage(
  projectId: string,
  item: SessionMessageWithAttachments,
  historyOrder?: number,
): TimelineUserMessage {
  const { message } = item;
  const blocks: TimelineUserMessage['blocks'] = [{
    blockId: `user-text:${message.message_id}`,
    kind: 'user_text',
    text: sessionMessageText(message),
    format: 'plain',
    createdAt: message.created_at,
    ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
  }, ...item.attachments.map((attachment) => ({
    blockId: `user-attachment:${attachment.attachment_id}`,
    kind: 'user_attachment' as const,
    attachmentId: attachment.attachment_id,
    name: attachment.name ?? attachment.attachment_id,
    ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
    source: attachment.source_type === 'local_file' ? 'local_file' as const : 'unknown' as const,
    createdAt: attachment.created_at,
  }))];
  return {
    messageId: message.message_id,
    role: 'user',
    projectId,
    sessionId: message.session_id,
    ...(message.run_id ? { runId: message.run_id } : {}),
    createdAt: message.created_at,
    ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
    ...(historyOrder !== undefined ? { historyOrder } : {}),
    blocks,
  };
}

function projectAssistantRun(
  projectId: string,
  runId: string,
  user: SessionMessageWithAttachments,
  messages: SessionMessageWithAttachments[],
  historyOrder: number,
  workspaceChangeFooter: TimelineAssistantMessage['workspaceChangeFooter'],
): TimelineAssistantMessage {
  const reply = messages.find((item): item is AssistantReplyItem =>
    item.message.message_kind === 'assistant_reply');
  const legacyAnswer = !reply ? findLegacyAnswer(messages) : undefined;
  const answerMessage = reply ?? legacyAnswer;
  const processItems = projectProcessItems(runId, messages, answerMessage?.message.message_id);
  const last = messages.at(-1) ?? user;
  const messageId = answerMessage?.message.message_id ?? `assistant:${runId}`;
  const blocks: TimelineAssistantMessage['blocks'] = [];
  if (processItems.length > 0) {
    blocks.push({
      blockId: `process:${runId}`,
      kind: 'process_disclosure',
      runId,
      status: processStatus(messages, reply?.message),
      startedAt: messages[0]?.message.created_at ?? user.message.created_at,
      endedAt: last.message.completed_at ?? last.message.created_at,
      items: processItems,
    });
  }
  blocks.push({
    blockId: `answer:${messageId}`,
    kind: 'answer_text',
    runId,
    textId: `text:${messageId}`,
    status: answerStatus(reply?.message, legacyAnswer),
    text: answerMessage ? sessionMessageText(answerMessage.message) : '',
    format: 'markdown',
    createdAt: answerMessage?.message.created_at ?? last.message.created_at,
    ...(answerMessage?.message.completed_at ? { updatedAt: answerMessage.message.completed_at } : {}),
  });
  return {
    messageId,
    role: 'assistant',
    projectId,
    sessionId: user.message.session_id,
    runId,
    createdAt: messages[0]?.message.created_at ?? user.message.created_at,
    updatedAt: last.message.completed_at ?? last.message.created_at,
    historyOrder,
    ...(workspaceChangeFooter ? { workspaceChangeFooter } : {}),
    blocks,
  };
}

function findLegacyAnswer(messages: SessionMessageWithAttachments[]): SessionMessageWithAttachments | undefined {
  return [...messages].reverse().find(({ message }) =>
    message.message_kind === 'model_response'
    && isLegacySessionMessage(message)
    && message.content.some((block) => block.type === 'text' && block.text.trim())
    && !message.content.some((block) => block.type === 'toolCall'));
}

function answerStatus(
  reply: SessionAssistantReplyMessage | undefined,
  legacyAnswer: SessionMessageWithAttachments | undefined,
): AnswerTextStatus {
  if (reply) return reply.status;
  return legacyAnswer ? 'legacy_unknown' : 'interrupted';
}

function projectProcessItems(
  runId: string,
  messages: SessionMessageWithAttachments[],
  answerMessageId?: string,
): ProcessDisclosureItem[] {
  const toolResults = new Map(messages.flatMap(({ message }) =>
    message.message_kind === 'tool_result' ? [[message.tool_call_id, message] as const] : []));
  const items: ProcessDisclosureItem[] = [];
  for (const [messageIndex, item] of messages.entries()) {
    const message = item.message;
    if (message.message_kind !== 'model_response' && message.message_kind !== 'assistant_reply') continue;
    for (const [blockIndex, block] of message.content.entries()) {
      if (block.type === 'thinking') {
        items.push({
          itemId: `thinking:${message.message_id}:${blockIndex}`,
          kind: 'thinking',
          thinkingId: `thinking:${runId}:${messageIndex}:${blockIndex}`,
          status: 'completed',
          text: block.thinking,
          format: 'markdown',
          createdAt: message.created_at,
        });
      } else if (
        message.message_kind === 'model_response' &&
        block.type === 'text' &&
        message.message_id !== answerMessageId
      ) {
        items.push({
          itemId: `assistant-text:${message.message_id}:${blockIndex}`,
          kind: 'assistant_text',
          textId: `text:${message.message_id}:${blockIndex}`,
          phase: 'prelude',
          status: 'completed',
          text: block.text,
          format: 'markdown',
          createdAt: message.created_at,
        });
      } else if (message.message_kind === 'model_response' && block.type === 'toolCall') {
        const result = toolResults.get(block.id);
        items.push({
          itemId: `tool:${block.id}`,
          kind: 'tool_activity',
          toolCallId: block.id,
          toolName: block.name,
          inputSummary: block.argumentsText,
          ...(result ? {
            toolResultId: `tool-result:${block.id}`,
            resultSummary: sessionMessageText(result),
            status: result.status === 'success' ? 'succeeded' as const : 'failed' as const,
          } : { status: 'requested' as const }),
          createdAt: message.created_at,
        });
      }
    }
  }
  return items;
}

function processStatus(
  messages: SessionMessageWithAttachments[],
  reply?: SessionAssistantReplyMessage,
): 'completed' | 'failed' | 'cancelled' | 'incomplete' {
  if (reply?.status === 'failed') return 'failed';
  if (reply?.status === 'cancelled') return 'cancelled';
  const resultIds = new Set(messages.flatMap(({ message }) =>
    message.message_kind === 'tool_result' ? [message.tool_call_id] : []));
  const modelResponses = messages.flatMap(({ message }) =>
    message.message_kind === 'model_response' ? [message] : []);
  if (modelResponses.some((message) => message.outcome_status === 'failed')) return 'failed';
  const hasIncompleteToolCall = modelResponses.some((message) => message.content.some((block) =>
    block.type === 'toolCall' && !resultIds.has(block.id)));
  return hasIncompleteToolCall ? 'incomplete' : 'completed';
}
