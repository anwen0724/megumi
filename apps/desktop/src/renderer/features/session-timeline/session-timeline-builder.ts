/*
 * Builds historical Desktop Timeline messages from Product Host Session facts.
 * The builder is pure: it performs no reads and owns no synchronization state.
 */
import type {
  RunDto,
  SessionConversationItemDto,
  SessionBranchConversationItemDto,
  SessionMessageConversationItemDto,
  SessionMessageDto,
  UserMessageDto,
  WorkspaceChangeSummaryDto,
} from '@megumi/product/host';
import type {
  AnswerTextStatus,
  ProcessDisclosureItem,
  TimelineAssistantMessage,
  TimelineMessage,
  TimelineUserMessage,
  WorkspaceChangeFooterFact,
} from './timeline-model';

export interface BuildSessionTimelineRequest {
  readonly projectId: string;
  readonly sessionId: string;
  readonly conversation: readonly SessionConversationItemDto[];
  readonly workspaceChanges: readonly WorkspaceChangeSummaryDto[];
  readonly activeRun?: RunDto;
}

export interface BuildCommittedRunTimelineRequest {
  readonly projectId: string;
  readonly messages: readonly SessionMessageConversationItemDto[];
  readonly workspaceChanges: readonly WorkspaceChangeSummaryDto[];
}

/** Builds the complete recoverable Timeline while preserving Session order. */
export function buildSessionTimeline(request: BuildSessionTimelineRequest): TimelineMessage[] {
  const messageItems = request.conversation.filter(
    (item): item is SessionMessageConversationItemDto => item.type === 'message',
  );
  const responsesByRun = groupResponsesByRun(messageItems);
  const workspaceByRun = groupWorkspaceChangesByRun(request.workspaceChanges);
  const timeline: TimelineMessage[] = [];

  for (const [historyOrder, item] of request.conversation.entries()) {
    if (item.type === 'branch') {
      timeline.push(toTimelineBranchSeparator(request.projectId, request.sessionId, item, historyOrder));
      continue;
    }
    if (item.type === 'compaction') {
      timeline.push({
        messageId: `session-compaction:${item.compactionId}`,
        role: 'activity',
        projectId: request.projectId,
        sessionId: request.sessionId,
        createdAt: item.startedAt,
        ...(item.completedAt ? { updatedAt: item.completedAt } : {}),
        historyOrder,
        blocks: [{
          blockId: `session-compaction-activity:${item.compactionId}`,
          kind: 'session_compaction_activity',
          activityId: item.compactionId,
          status: item.status,
          ...(item.error ? { error: { ...item.error } } : {}),
          createdAt: item.startedAt,
          ...(item.completedAt ? { updatedAt: item.completedAt } : {}),
        }],
      });
      continue;
    }
    if (item.message.kind !== 'user') continue;
    timeline.push(toTimelineUserMessage(request.projectId, item.message, historyOrder));
    const runId = item.message.runId;
    if (!runId) continue;
    if (runId === request.activeRun?.runId) {
      timeline.push(toActiveTimelineAssistantMessage({
        projectId: request.projectId,
        runId,
        user: item.message,
        responses: responsesByRun.get(runId) ?? [],
        historyOrder: historyOrder + 1,
      }));
      continue;
    }
    timeline.push(toTimelineAssistantMessage({
      projectId: request.projectId,
      runId,
      user: item.message,
      responses: responsesByRun.get(runId) ?? [],
      historyOrder: historyOrder + 1,
      workspaceChangeFooter: workspaceByRun.get(runId),
    }));
  }
  return timeline;
}

/** Converts one committed Branch fact into its stable Desktop separator identity. */
export function toTimelineBranchSeparator(
  projectId: string,
  sessionId: string,
  branch: SessionBranchConversationItemDto,
  historyOrder?: number,
): TimelineMessage {
  return {
    messageId: `branch:${branch.branchId}`,
    role: 'separator',
    projectId,
    sessionId,
    createdAt: branch.createdAt,
    ...(historyOrder === undefined ? {} : { historyOrder }),
    blocks: [{
      blockId: `branch-separator:${branch.branchId}`,
      kind: 'branch_separator',
      branchMarkerId: branch.branchId,
      sourceMessageId: branch.sourceMessageId,
      createdAt: branch.createdAt,
    }],
  };
}

/** Builds the recoverable portion of an active Run without inventing lost streaming content. */
function toActiveTimelineAssistantMessage(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly user: UserMessageDto;
  readonly responses: readonly SessionMessageDto[];
  readonly historyOrder: number;
}): TimelineAssistantMessage {
  const last = input.responses.at(-1) ?? input.user;
  return {
    messageId: `assistant:${input.runId}`,
    role: 'assistant',
    projectId: input.projectId,
    sessionId: input.user.sessionId,
    runId: input.runId,
    createdAt: input.responses[0]?.createdAt ?? input.user.createdAt,
    updatedAt: last.completedAt ?? last.createdAt,
    historyOrder: input.historyOrder,
    blocks: [{
      blockId: `process:${input.runId}`,
      kind: 'process_disclosure',
      runId: input.runId,
      status: 'running',
      startedAt: input.user.createdAt,
      items: buildProcessItems(input.runId, input.responses),
    }],
  };
}

/** Builds only one committed Run for terminal reconciliation. */
export function buildCommittedRunTimeline(
  request: BuildCommittedRunTimelineRequest,
): TimelineMessage[] {
  const user = request.messages.find(
    (item): item is SessionMessageConversationItemDto & { message: UserMessageDto } =>
      item.message.kind === 'user',
  );
  if (!user?.message.runId) return [];
  const runId = user.message.runId;
  const responses = request.messages
    .filter((item) => item.message.kind !== 'user' && item.message.runId === runId)
    .map((item) => item.message);
  return [
    toTimelineUserMessage(request.projectId, user.message),
    toTimelineAssistantMessage({
      projectId: request.projectId,
      runId,
      user: user.message,
      responses,
      workspaceChangeFooter: groupWorkspaceChangesByRun(request.workspaceChanges).get(runId),
    }),
  ];
}

/** Converts one Host-safe persisted User Message into its Desktop representation. */
export function toTimelineUserMessage(
  projectId: string,
  message: UserMessageDto,
  historyOrder?: number,
): TimelineUserMessage {
  const text = message.displayContent
    .filter((content): content is Extract<typeof content, { type: 'text' }> => content.type === 'text')
    .map((content) => content.text)
    .join('');
  const blocks: TimelineUserMessage['blocks'] = [
    ...(text ? [{
      blockId: `user-text:${message.messageId}`,
      kind: 'user_text' as const,
      text,
      format: 'plain' as const,
      createdAt: message.createdAt,
      ...(message.completedAt ? { updatedAt: message.completedAt } : {}),
    }] : []),
    ...[...message.attachments]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((attachment) => ({
        blockId: `user-attachment:${attachment.attachmentId}`,
        kind: 'user_attachment' as const,
        attachmentId: attachment.attachmentId,
        attachmentType: attachment.type,
        name: attachment.name ?? attachment.attachmentId,
        ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
        ...(attachment.sizeBytes === undefined ? {} : { sizeBytes: attachment.sizeBytes }),
        source: attachment.source === 'localFile' ? 'local_file' as const : 'unknown' as const,
        createdAt: attachment.createdAt,
      })),
  ];
  return {
    messageId: message.messageId,
    role: 'user',
    projectId,
    sessionId: message.sessionId,
    ...(message.runId ? { runId: message.runId } : {}),
    ...(message.skillSelection ? { skillSelection: { ...message.skillSelection } } : {}),
    createdAt: message.createdAt,
    ...(message.completedAt ? { updatedAt: message.completedAt } : {}),
    ...(historyOrder === undefined ? {} : { historyOrder }),
    blocks,
  };
}

/** Materializes one persisted Run into its disclosure and final-answer blocks. */
function toTimelineAssistantMessage(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly user: UserMessageDto;
  readonly responses: readonly SessionMessageDto[];
  readonly historyOrder?: number;
  readonly workspaceChangeFooter?: WorkspaceChangeFooterFact;
}): TimelineAssistantMessage {
  const reply = input.responses.find((message) => message.kind === 'assistantReply');
  const legacyAnswer = !reply ? findLegacyAnswer(input.responses) : undefined;
  const answer = reply ?? legacyAnswer;
  const last = input.responses.at(-1) ?? input.user;
  const messageId = answer?.messageId ?? `assistant:${input.runId}`;
  return {
    messageId,
    role: 'assistant',
    projectId: input.projectId,
    sessionId: input.user.sessionId,
    runId: input.runId,
    createdAt: input.responses[0]?.createdAt ?? input.user.createdAt,
    updatedAt: last.completedAt ?? last.createdAt,
    ...(input.historyOrder === undefined ? {} : { historyOrder: input.historyOrder }),
    ...(input.workspaceChangeFooter ? { workspaceChangeFooter: input.workspaceChangeFooter } : {}),
    blocks: [{
      blockId: `process:${input.runId}`,
      kind: 'process_disclosure',
      runId: input.runId,
      status: processStatus(input.responses, reply),
      startedAt: input.user.createdAt,
      endedAt: last.completedAt ?? last.createdAt,
      items: buildProcessItems(input.runId, input.responses, answer?.messageId),
    }, {
      blockId: `answer:${messageId}`,
      kind: 'answer_text',
      runId: input.runId,
      textId: `text:${messageId}`,
      status: answerStatus(reply, legacyAnswer),
      text: answer ? assistantText(answer) : '',
      format: 'markdown',
      createdAt: answer?.createdAt ?? last.createdAt,
      ...(answer?.completedAt ? { updatedAt: answer.completedAt } : {}),
    }],
  };
}

/** Reconstructs Thinking and Tool activity from the Run's persisted message sequence. */
function buildProcessItems(
  runId: string,
  messages: readonly SessionMessageDto[],
  answerMessageId?: string,
): ProcessDisclosureItem[] {
  const toolResults = new Map(messages.flatMap((message) =>
    message.kind === 'toolResult' ? [[message.toolCallId, message] as const] : []));
  const items: ProcessDisclosureItem[] = [];
  for (const message of messages) {
    if (message.kind !== 'modelResponse' && message.kind !== 'assistantReply') continue;
    for (const block of message.content) {
      if (block.type === 'thinking') {
        items.push({
          // The live reducer keys thinking items by the model-call message id;
          // the committed reconstruction must use the same identity so
          // reconciliation merges instead of duplicating the block.
          itemId: `thinking:${message.messageId}`,
          kind: 'thinking',
          thinkingId: message.messageId,
          status: 'completed',
          text: block.thinking,
          format: 'markdown',
          createdAt: message.createdAt,
        });
      } else if (block.type === 'text' && message.messageId !== answerMessageId) {
        items.push({
          itemId: `assistant-text:text:${message.messageId}`,
          kind: 'assistant_text',
          textId: `text:${message.messageId}`,
          phase: 'prelude',
          status: 'completed',
          text: block.text,
          format: 'markdown',
          createdAt: message.createdAt,
        });
      } else if (message.kind === 'modelResponse' && block.type === 'toolCall') {
        const result = toolResults.get(block.id);
        items.push({
          itemId: `tool:${block.id}`,
          kind: 'tool_activity',
          toolCallId: block.id,
          toolName: block.name,
          inputSummary: summarizeToolTarget(block.name, block.arguments),
          ...(result ? {
            status: toolResultStatus(result.status),
            ...(result.error ? { error: result.error } : {}),
          } : { status: 'requested' as const }),
          createdAt: message.createdAt,
        });
      }
    }
  }
  return items;
}

function groupResponsesByRun(
  items: readonly SessionMessageConversationItemDto[],
): Map<string, SessionMessageDto[]> {
  const groups = new Map<string, SessionMessageDto[]>();
  for (const { message } of items) {
    if (message.kind === 'user' || !message.runId) continue;
    const group = groups.get(message.runId) ?? [];
    group.push(message);
    groups.set(message.runId, group);
  }
  return groups;
}

function groupWorkspaceChangesByRun(
  summaries: readonly WorkspaceChangeSummaryDto[],
): Map<string, WorkspaceChangeFooterFact> {
  const groups = new Map<string, WorkspaceChangeSummaryDto[]>();
  for (const summary of summaries) {
    const group = groups.get(summary.runId) ?? [];
    group.push(summary);
    groups.set(summary.runId, group);
  }
  return new Map([...groups].map(([runId, group]) => [runId, {
    runId,
    sessionId: group[0]?.sessionId ?? '',
    updatedAt: group.reduce((latest, summary) => summary.updatedAt > latest ? summary.updatedAt : latest, ''),
    changeSets: group.map((summary) => ({
      changeSetId: summary.changeSetId,
      changedFileCount: summary.changedFileCount,
      files: summary.files.map((file) => ({ ...file })),
    })),
  }]));
}

function findLegacyAnswer(messages: readonly SessionMessageDto[]): SessionMessageDto | undefined {
  return [...messages].reverse().find((message) =>
    message.kind === 'modelResponse'
    && message.content.some((block) => block.type === 'text' && block.text.trim())
    && !message.content.some((block) => block.type === 'toolCall'));
}

function answerStatus(
  reply: SessionMessageDto | undefined,
  legacyAnswer: SessionMessageDto | undefined,
): AnswerTextStatus {
  if (reply?.kind === 'assistantReply') return reply.status;
  return legacyAnswer ? 'legacy_unknown' : 'interrupted';
}

function processStatus(
  messages: readonly SessionMessageDto[],
  reply: SessionMessageDto | undefined,
): 'completed' | 'failed' | 'cancelled' | 'incomplete' {
  if (reply?.kind === 'assistantReply' && reply.status !== 'completed') return reply.status;
  const toolResults = new Set(messages.flatMap((message) =>
    message.kind === 'toolResult' ? [message.toolCallId] : []));
  const responses = messages.filter((message) => message.kind === 'modelResponse');
  if (responses.some((message) => message.outcomeStatus === 'failed')) return 'failed';
  return responses.some((message) => message.content.some(
    (block) => block.type === 'toolCall' && !toolResults.has(block.id),
  )) ? 'incomplete' : 'completed';
}

function assistantText(message: SessionMessageDto): string {
  if (message.kind !== 'modelResponse' && message.kind !== 'assistantReply') return '';
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function toolResultStatus(status: Extract<SessionMessageDto, { kind: 'toolResult' }>['status']) {
  if (status === 'success') return 'succeeded' as const;
  if (status === 'permission_denied' || status === 'user_rejected') return 'denied' as const;
  if (status === 'cancelled') return 'cancelled' as const;
  return 'failed' as const;
}

function summarizeToolTarget(toolName: string, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const field = toolName === 'glob' ? 'pattern'
    : toolName === 'search_text' || toolName === 'web_search' ? 'query'
      : toolName === 'run_command' ? 'command'
        : toolName === 'web_fetch' ? 'url'
          : 'path';
  const value = input[field];
  if (typeof value !== 'string' || value.length === 0) return field === 'path' ? '工作区目录' : undefined;
  return field === 'path' && value === '.' ? '工作区目录' : value;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
