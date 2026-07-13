/*
 * Projects Session-owned semantic messages into historical Timeline DTOs.
 * Runtime Events remain a separate source used only while a Run is live.
 */
import { sessionConversationText, type SessionMessageWithAttachments, type SessionService } from '../../session';
import type { WorkspaceChangeFooterProjectorService } from '../workspace/workspace-change-footer-projector';
import type {
  ProcessDisclosureItem,
  TimelineAssistantMessage,
  TimelineMessage,
  TimelineUserMessage,
} from './timeline-message-blocks';

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
      if (result.status === 'failed') return { messages: [], diagnostics: [] };
      const projected = projectSessionTimelineMessages({
        projectId: request.workspace_id,
        messages: result.messages,
        ...(request.run_id ? { requestedRunId: request.run_id } : {}),
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
  workspaceChangeFooterProjector?: Pick<WorkspaceChangeFooterProjectorService, 'projectRunFooter'>;
}): TimelineMessage[] {
  const responseGroups = groupResponsesByRun(input.messages);
  const emittedRuns = new Set<string>();
  const timeline: TimelineMessage[] = [];

  for (const item of input.messages) {
    if (item.message.conversation.role === 'user') {
      timeline.push(projectUserMessage(input.projectId, item, item.active_path_order ?? timeline.length));
      continue;
    }
    const runId = item.message.run_id;
    if (!runId || emittedRuns.has(runId)) continue;
    emittedRuns.add(runId);
    const group = responseGroups.get(runId);
    if (group?.length) {
      timeline.push(projectAssistantRun(
        input.projectId,
        runId,
        group,
        item.active_path_order ?? timeline.length,
        !input.requestedRunId || input.requestedRunId === runId
          ? input.workspaceChangeFooterProjector?.projectRunFooter(runId)
          : undefined,
      ));
    }
  }
  return timeline;
}

function groupResponsesByRun(messages: SessionMessageWithAttachments[]): Map<string, SessionMessageWithAttachments[]> {
  const groups = new Map<string, SessionMessageWithAttachments[]>();
  for (const item of messages) {
    if (item.message.conversation.role === 'user' || !item.message.run_id) continue;
    const group = groups.get(item.message.run_id) ?? [];
    group.push(item);
    groups.set(item.message.run_id, group);
  }
  return groups;
}

function projectUserMessage(projectId: string, item: SessionMessageWithAttachments, historyOrder: number): TimelineUserMessage {
  const { message } = item;
  const blocks: TimelineUserMessage['blocks'] = [{
    blockId: `user-text:${message.message_id}`,
    kind: 'user_text',
    text: sessionConversationText(message.conversation),
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
    historyOrder,
    blocks,
  };
}

function projectAssistantRun(
  projectId: string,
  runId: string,
  messages: SessionMessageWithAttachments[],
  historyOrder: number,
  workspaceChangeFooter: TimelineAssistantMessage['workspaceChangeFooter'],
): TimelineAssistantMessage {
  const assistantMessages = messages.filter((item) => item.message.conversation.role === 'assistant');
  const finalAssistant = [...assistantMessages].reverse().find((item) => {
    const conversation = item.message.conversation;
    return conversation.role === 'assistant'
      && conversation.content.some((block) => block.type === 'text')
      && !conversation.content.some((block) => block.type === 'toolCall');
  });
  const processItems = projectProcessItems(runId, messages, finalAssistant?.message.message_id);
  const last = messages.at(-1)!;
  const messageId = finalAssistant?.message.message_id ?? last.message.message_id;
  const blocks: TimelineAssistantMessage['blocks'] = [];
  if (processItems.length > 0) {
    blocks.push({
      blockId: `process:${runId}`,
      kind: 'process_disclosure',
      runId,
      status: processStatus(messages),
      startedAt: messages[0]!.message.created_at,
      endedAt: last.message.completed_at ?? last.message.created_at,
      items: processItems,
    });
  }
  if (finalAssistant) {
    blocks.push({
      blockId: `answer:${finalAssistant.message.message_id}`,
      kind: 'answer_text',
      runId,
      textId: `text:${finalAssistant.message.message_id}`,
      status: finalAssistant.message.conversation.role === 'assistant'
        && finalAssistant.message.conversation.stopReason?.includes('cancel')
        ? 'cancelled_partial'
        : finalAssistant.message.conversation.role === 'assistant'
          && finalAssistant.message.conversation.stopReason?.includes('fail')
          ? 'failed'
          : 'completed',
      text: sessionConversationText(finalAssistant.message.conversation),
      format: 'markdown',
      createdAt: finalAssistant.message.created_at,
      ...(finalAssistant.message.completed_at ? { updatedAt: finalAssistant.message.completed_at } : {}),
    });
  }
  if (blocks.length === 0) {
    blocks.push({
      blockId: `process:${runId}`,
      kind: 'process_disclosure', runId, status: 'completed', items: [],
    });
  }
  return {
    messageId,
    role: 'assistant',
    projectId,
    sessionId: last.message.session_id,
    runId,
    createdAt: messages[0]!.message.created_at,
    updatedAt: last.message.completed_at ?? last.message.created_at,
    historyOrder,
    ...(workspaceChangeFooter ? { workspaceChangeFooter } : {}),
    blocks,
  };
}

function projectProcessItems(
  runId: string,
  messages: SessionMessageWithAttachments[],
  finalAssistantMessageId?: string,
): ProcessDisclosureItem[] {
  const toolResults = new Map(messages.flatMap((item) => {
    const message = item.message.conversation;
    return message.role === 'toolResult' ? [[message.toolCallId, message] as const] : [];
  }));
  const items: ProcessDisclosureItem[] = [];
  for (const [messageIndex, item] of messages.entries()) {
    const message = item.message.conversation;
    if (message.role !== 'assistant') continue;
    for (const [blockIndex, block] of message.content.entries()) {
      if (block.type === 'thinking') {
        items.push({
          itemId: `thinking:${item.message.message_id}:${blockIndex}`,
          kind: 'thinking', thinkingId: `thinking:${runId}:${messageIndex}:${blockIndex}`,
          status: 'completed', text: block.thinking, format: 'markdown',
          createdAt: item.message.created_at,
        });
      } else if (block.type === 'text' && item.message.message_id !== finalAssistantMessageId) {
        items.push({
          itemId: `assistant-text:${item.message.message_id}:${blockIndex}`,
          kind: 'assistant_text', textId: `text:${item.message.message_id}:${blockIndex}`,
          phase: 'prelude', status: 'completed', text: block.text, format: 'markdown',
          createdAt: item.message.created_at,
        });
      } else if (block.type === 'toolCall') {
        const result = toolResults.get(block.id);
        items.push({
          itemId: `tool:${block.id}`,
          kind: 'tool_activity', toolCallId: block.id, toolName: block.name,
          inputSummary: block.argumentsText,
          ...(result ? {
            toolResultId: `tool-result:${block.id}`,
            resultSummary: sessionConversationText(result),
            status: result.status === 'success' ? 'succeeded' as const : 'failed' as const,
          } : { status: 'requested' as const }),
          createdAt: item.message.created_at,
        });
      }
    }
  }
  return items;
}

function processStatus(messages: SessionMessageWithAttachments[]): 'completed' | 'failed' | 'cancelled' | 'incomplete' {
  const assistantMessages = messages.flatMap((item) => (
    item.message.conversation.role === 'assistant' ? [item.message.conversation] : []
  ));
  if (assistantMessages.some((message) => message.stopReason?.includes('cancel'))) return 'cancelled';
  if (assistantMessages.some((message) => message.stopReason?.includes('fail'))) return 'failed';
  const resultIds = new Set(messages.flatMap((item) => (
    item.message.conversation.role === 'toolResult' ? [item.message.conversation.toolCallId] : []
  )));
  const hasIncompleteToolCall = assistantMessages.some((message) => message.content.some((block) => (
    block.type === 'toolCall' && !resultIds.has(block.id)
  )));
  return hasIncompleteToolCall ? 'incomplete' : 'completed';
}
