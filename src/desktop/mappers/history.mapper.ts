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

export function mapSessionToRendererSummary(session: Session): RendererSessionSummaryDto {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.metadata ? { metadata: session.metadata } : {}),
  };
}

export function mapTimelineHydration(input: {
  sessionId: string;
  messages: SessionMessage[];
  runs: SessionRunRecord[];
  activePath: SessionSourceEntry[];
}): RendererTimelineHydrationDto {
  return {
    sessionId: input.sessionId,
    messages: input.messages.map(mapMessage),
    runs: input.runs.map(mapRun),
    activePath: input.activePath.map(mapSourceEntry),
    diagnostics: [],
  };
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
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    type: event.type,
    runId: event.runId ?? '',
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    occurredAt: event.occurredAt,
    payload: event.payload ?? {},
  };
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

function mapMessage(message: SessionMessage): RendererTimelineMessageDto {
  return {
    messageId: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.metadata ? { metadata: message.metadata } : {}),
  };
}

function mapRun(run: SessionRunRecord): RendererRunSummaryDto {
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

function mapSourceEntry(entry: SessionSourceEntry): RendererSourceEntryDto {
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
