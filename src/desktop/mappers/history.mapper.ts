// Projects session and runtime owner facts into renderer history DTOs.
import type {
  RendererBranchDraftDto,
  RendererRecoverableRunDto,
  RendererRuntimeEventHistoryDto,
  RendererRunSummaryDto,
  RendererSessionSummaryDto,
  RendererSourceEntryDto,
  RendererTimelineHydrationDto,
  RendererTimelineMessageDto,
} from '../../shared';
import type { BranchMarker, Session, SessionMessage, SessionRunRecord, SessionSourceEntry } from '../../session';
import type { RecoverableRunRecord, RuntimeEventRecord } from '../../database';
import type { JsonObject, JsonValue } from '../../shared';
import type { AnswerTextBlock, ProcessDisclosureBlock, TimelineMessage } from '../../shared/renderer-contracts/timeline';
import { reduceChatStreamEvent } from '../../shared/renderer-contracts/timeline';
import { mapAgentRuntimeEventToRendererRuntimeEvent } from './agent-runtime-event-to-renderer-runtime-event.mapper';
import { createAgentRuntimeChatStreamAdapter } from './agent-runtime-chat-stream-adapter';

export function mapSessionToRendererSummary(session: Session): RendererSessionSummaryDto {
  return {
    sessionId: session.id,
    title: session.title,
    status: session.status,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.workspacePath ? { workspacePath: session.workspacePath } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.metadata ? { metadata: session.metadata } : {}),
  };
}

export function mapTimelineHydration(input: {
  projectId: string;
  sessionId: string;
  messages: SessionMessage[];
  runs: SessionRunRecord[];
  activePath: SessionSourceEntry[];
  runtimeEvents?: RuntimeEventRecord[];
}): RendererTimelineHydrationDto {
  const runIdByMessageId = buildRunIdByMessageId(input.activePath);
  const messages = input.messages.flatMap((message) => mapMessage(message, input.projectId, runIdByMessageId));
  return {
    sessionId: input.sessionId,
    messages: dedupeAssistantMessagesByRun(mergeRuntimeEventProjection(messages, input.runtimeEvents ?? [])),
    runs: input.runs.map(mapRunToRendererSummary),
    activePath: input.activePath.map(mapSourceEntry),
    diagnostics: [],
  };
}

type RendererAssistantTimelineMessage = Extract<RendererTimelineMessageDto, { role: 'assistant' }>;

function dedupeAssistantMessagesByRun(messages: RendererTimelineMessageDto[]): RendererTimelineMessageDto[] {
  const result: RendererTimelineMessageDto[] = [];
  const assistantIndexByRunId = new Map<string, number>();

  for (const message of [...messages].sort(compareTimelineMessages)) {
    if (message.role !== 'assistant') {
      result.push(message);
      continue;
    }

    const existingIndex = assistantIndexByRunId.get(message.runId);
    if (existingIndex === undefined) {
      assistantIndexByRunId.set(message.runId, result.length);
      result.push(message);
      continue;
    }

    result[existingIndex] = mergeAssistantTimelineMessages(
      result[existingIndex] as RendererAssistantTimelineMessage,
      message,
    );
  }

  return result.sort(compareTimelineMessages);
}

function mergeAssistantTimelineMessages(
  current: RendererAssistantTimelineMessage,
  incoming: RendererAssistantTimelineMessage,
): RendererAssistantTimelineMessage {
  const blocks = [...current.blocks];
  const incomingProcess = incoming.blocks.find(
    (block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure',
  );
  const currentProcessIndex = blocks.findIndex((block) => block.kind === 'process_disclosure');
  if (incomingProcess) {
    if (currentProcessIndex === -1) {
      blocks.unshift(incomingProcess);
    } else {
      const currentProcess = blocks[currentProcessIndex] as ProcessDisclosureBlock;
      if (incomingProcess.items.length > currentProcess.items.length || currentProcess.items.length === 0) {
        blocks[currentProcessIndex] = incomingProcess;
      }
    }
  }

  const incomingAnswer = incoming.blocks.find(
    (block): block is AnswerTextBlock => block.kind === 'answer_text' && block.text.length > 0,
  );
  const currentAnswerIndex = blocks.findIndex((block) => block.kind === 'answer_text');
  if (incomingAnswer) {
    if (currentAnswerIndex === -1) {
      blocks.push(incomingAnswer);
    } else {
      const currentAnswer = blocks[currentAnswerIndex] as AnswerTextBlock;
      if (incomingAnswer.text.length >= currentAnswer.text.length) {
        blocks[currentAnswerIndex] = incomingAnswer;
      }
    }
  }

  return {
    ...current,
    updatedAt: maxIsoDate(current.updatedAt ?? current.createdAt, incoming.updatedAt ?? incoming.createdAt),
    blocks,
    ...(incoming.workspaceChangeFooter ? { workspaceChangeFooter: incoming.workspaceChangeFooter } : {}),
  };
}

function mergeRuntimeEventProjection(
  messages: RendererTimelineMessageDto[],
  runtimeEvents: RuntimeEventRecord[],
): RendererTimelineMessageDto[] {
  if (runtimeEvents.length === 0) {
    return messages;
  }

  let projected: TimelineMessage[] = [];
  const adapter = createAgentRuntimeChatStreamAdapter({
    publish(event) {
      projected = reduceChatStreamEvent(projected, event);
    },
  });
  for (const event of [...runtimeEvents].sort((left, right) => left.sequence - right.sequence)) {
    adapter.handle(event);
  }
  adapter.dispose();

  if (projected.length === 0) {
    return messages;
  }

  const next = [...messages];
  for (const projectedMessage of projected) {
    if (projectedMessage.role !== 'assistant') {
      continue;
    }

    const targetIndex = next.findIndex((message) =>
      message.role === 'assistant' && message.runId === projectedMessage.runId
    );
    if (targetIndex === -1) {
      next.push(projectedMessage);
      continue;
    }

    next[targetIndex] = mergeAssistantRuntimeProjection(next[targetIndex], projectedMessage);
  }

  return next.sort(compareTimelineMessages);
}

function mergeAssistantRuntimeProjection(
  current: RendererTimelineMessageDto,
  projected: Extract<TimelineMessage, { role: 'assistant' }>,
): RendererTimelineMessageDto {
  if (current.role !== 'assistant') {
    return current;
  }

  const projectedProcess = projected.blocks.find(
    (block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure',
  );
  if (!projectedProcess) {
    return current;
  }

  const blocks = current.blocks.map((block) =>
    block.kind === 'process_disclosure' ? projectedProcess : block
  );
  if (!blocks.some((block) => block.kind === 'process_disclosure')) {
    blocks.unshift(projectedProcess);
  }

  return {
    ...current,
    updatedAt: projected.updatedAt ?? current.updatedAt,
    blocks,
    ...(projected.workspaceChangeFooter ? { workspaceChangeFooter: projected.workspaceChangeFooter } : {}),
  };
}

function compareTimelineMessages(left: RendererTimelineMessageDto, right: RendererTimelineMessageDto): number {
  const createdOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdOrder !== 0) return createdOrder;

  const leftRun = 'runId' in left ? String(left.runId ?? '') : '';
  const rightRun = 'runId' in right ? String(right.runId ?? '') : '';
  const runOrder = leftRun.localeCompare(rightRun);
  if (runOrder !== 0) return runOrder;

  const leftTurn = typeof left.turnOrder === 'number' ? left.turnOrder : left.role === 'user' ? 0 : 1;
  const rightTurn = typeof right.turnOrder === 'number' ? right.turnOrder : right.role === 'user' ? 0 : 1;
  if (leftTurn !== rightTurn) return leftTurn - rightTurn;

  return String(left.messageId).localeCompare(String(right.messageId));
}

function maxIsoDate(left: string, right: string): string {
  return right.localeCompare(left) > 0 ? right : left;
}

export function mapBranchDraft(input: {
  marker: BranchMarker;
  sourceMessage: SessionMessage;
  intent: 'branch' | 'rerun';
}): RendererBranchDraftDto {
  return {
    branchMarkerId: input.marker.id,
    sessionId: input.marker.sessionId,
    sourceMessageId: input.sourceMessage.id,
    seedText: messageSeedText(input.sourceMessage.content),
    label: input.marker.label ?? (input.intent === 'rerun' ? 'Rerun from message' : 'Branch from message'),
    intent: input.intent,
    createdAt: input.marker.createdAt,
  };
}

export function mapRuntimeEventHistory(event: RuntimeEventRecord): RendererRuntimeEventHistoryDto {
  return mapAgentRuntimeEventToRendererRuntimeEvent({
    type: event.type,
    occurredAt: event.occurredAt,
    ...(event.runId ? { runId: event.runId } : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    payload: {
      ...jsonObjectOrEmpty(event.payload),
      eventId: event.eventId,
      sequence: event.sequence,
      ...(event.runId ? { runId: event.runId } : {}),
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    },
  }, { sequence: event.sequence });
}

export function mapRecoverableRun(run: RecoverableRunRecord): RendererRecoverableRunDto {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    status: run.status,
    reason: run.reason,
    ...(run.title ? { title: run.title } : {}),
    ...(run.preview ? { preview: run.preview } : {}),
    ...(run.workspaceId ? { workspaceId: run.workspaceId } : {}),
    ...(run.metadata ? { metadata: run.metadata } : {}),
  };
}

function mapMessage(
  message: SessionMessage,
  projectId: string,
  runIdByMessageId: Map<string, string>,
): RendererTimelineMessageDto[] {
  if (message.role === 'user') {
    return [mapUserMessage(message, projectId, runIdByMessageId)];
  }

  if (message.role === 'assistant') {
    const assistant = mapAssistantMessage(message, projectId);
    return assistant ? [assistant] : [];
  }

  return [];
}

function mapUserMessage(
  message: SessionMessage,
  projectId: string,
  runIdByMessageId: Map<string, string>,
): RendererTimelineMessageDto {
  const runId = readString(message.metadata?.agentRunId)
    ?? readStringFromObject(message.content, 'runId')
    ?? runIdByMessageId.get(message.id);
  const text = userMessageText(message.content);
  return stripUndefinedFields({
    messageId: message.id,
    role: 'user',
    projectId,
    sessionId: message.sessionId,
    runId,
    clientMessageId: readString(message.metadata?.clientMessageId) ?? readStringFromObject(message.content, 'parsedInputId'),
    turnOrder: 0,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    blocks: [{
      blockId: `user-text:${message.id}`,
      kind: 'user_text',
      text,
      format: 'plain',
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
    }],
  }) as RendererTimelineMessageDto;
}

function mapAssistantMessage(message: SessionMessage, projectId: string): RendererTimelineMessageDto | undefined {
  const runId = readString(message.metadata?.agentRunId) ?? readStringFromObject(message.content, 'runId');
  if (!runId) {
    return undefined;
  }

  const answerText = assistantAnswerText(message.content);
  const processBlock: ProcessDisclosureBlock = {
    blockId: `process:${runId}`,
    kind: 'process_disclosure',
    runId,
    status: 'completed',
    startedAt: message.createdAt,
    endedAt: message.createdAt,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    items: [],
  };
  const blocks: TimelineMessage['blocks'] = [processBlock];

  if (answerText.length > 0) {
    const answerBlock: AnswerTextBlock = {
      blockId: `answer:${runId}`,
      kind: 'answer_text',
      runId,
      textId: `assistant-text:${runId}:answer:0`,
      status: 'completed',
      text: answerText,
      format: 'markdown',
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
    };
    blocks.push(answerBlock);
  }

  return {
    messageId: message.id,
    role: 'assistant',
    projectId,
    sessionId: message.sessionId,
    runId,
    turnOrder: 1,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    blocks,
  };
}

export function mapRunToRendererSummary(run: SessionRunRecord): RendererRunSummaryDto {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    sourceEntryId: run.sourceEntryId,
    inputSummary: run.inputSummary,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.metadata ? { metadata: run.metadata } : {}),
  };
}

export function mapSourceEntry(entry: SessionSourceEntry): RendererSourceEntryDto {
  return {
    sourceEntryId: entry.id,
    ...(entry.parentId ? { parentId: entry.parentId } : {}),
    kind: entry.kind,
    ref: entry.ref as JsonValue,
    createdAt: entry.createdAt,
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
  };
}

function messageSeedText(content: JsonValue): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const record = content as JsonObject;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
  }
  return JSON.stringify(content);
}

function buildRunIdByMessageId(activePath: SessionSourceEntry[]): Map<string, string> {
  const runIdByMessageId = new Map<string, string>();
  let previousMessageId: string | undefined;

  for (const entry of activePath) {
    if (entry.kind === 'message' && isRecord(entry.ref) && entry.ref.type === 'message') {
      previousMessageId = readString(entry.ref.messageId);
      continue;
    }

    if (entry.kind === 'run' && previousMessageId && isRecord(entry.ref) && entry.ref.type === 'run') {
      const runId = readString(entry.ref.runId);
      if (runId) {
        runIdByMessageId.set(previousMessageId, runId);
      }
      previousMessageId = undefined;
    }
  }

  return runIdByMessageId;
}

function userMessageText(content: JsonValue): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return '';
  const record = content as JsonObject;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  return JSON.stringify(content);
}

function assistantAnswerText(content: JsonValue): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return '';

  const record = content as JsonObject;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;

  if (Array.isArray(record.content)) {
    return record.content
      .map((block) => {
        if (!block || typeof block !== 'object' || Array.isArray(block)) return '';
        const blockRecord = block as JsonObject;
        return typeof blockRecord.text === 'string' ? blockRecord.text : '';
      })
      .join('');
  }

  return '';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringFromObject(value: JsonValue, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return readString((value as JsonObject)[key]);
}

function stripUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function jsonObjectOrEmpty(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
