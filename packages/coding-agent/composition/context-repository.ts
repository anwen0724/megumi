/*
 * Maps existing Coding Agent persistence records into Context module contracts.
 */
import type {
  ContextCompaction,
  ContextSessionFactRepository,
  SessionContextSource,
} from '../context';
import type { SessionHistoryItem, SessionService } from '../session';

export type PersistedSessionMessage = {
  messageId: string;
  sessionId?: string;
  role: 'user' | 'assistant';
  content: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
};

export type PersistedSessionCompaction = {
  compactionId: string;
  summary: string;
  status: 'completed';
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type PersistedRuntimeEvent = {
  eventId: string;
  eventType: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export function mapSessionMessageToContextSource(message: PersistedSessionMessage): SessionContextSource {
  return {
    source_id: message.messageId,
    source_kind: 'session_message',
    text: message.content,
    persisted: true,
    created_at: message.createdAt,
    metadata: compactMetadata({
      ...message.metadata,
      role: message.role,
      status: message.status,
      completed_at: message.completedAt,
    }),
  };
}

export function mapSessionCompactionToContextSource(compaction: PersistedSessionCompaction): SessionContextSource {
  return {
    source_id: compaction.compactionId,
    source_kind: 'context_compaction_summary',
    text: compaction.summary,
    persisted: true,
    created_at: compaction.createdAt,
    metadata: compactMetadata({
      ...compaction.metadata,
      status: compaction.status,
    }),
  };
}

export function mapRuntimeEventToRuntimeFactSource(event: PersistedRuntimeEvent): SessionContextSource | undefined {
  if (isProviderContinuationStateEvent(event) || !event.payload) {
    return undefined;
  }

  if (event.eventType === 'tool.result.created') {
    const summary = event.payload.summary;
    if (typeof summary !== 'string' || summary.trim().length === 0) {
      return undefined;
    }
    return {
      source_id: event.eventId,
      source_kind: 'tool_result',
      text: summary,
      persisted: true,
      created_at: event.createdAt,
      metadata: { event_type: event.eventType },
    };
  }

  if (isModelRelevantRuntimeFact(event.eventType)) {
    const text = runtimeFactText(event);
    if (!text) {
      return undefined;
    }
    return {
      source_id: event.eventId,
      source_kind: 'runtime_fact',
      text,
      persisted: true,
      created_at: event.createdAt,
      metadata: { event_type: event.eventType },
    };
  }

  return undefined;
}

export class ContextRepository implements ContextSessionFactRepository {
  constructor(private readonly ports: {
    sessionService: Pick<SessionService, 'getActiveHistory' | 'saveCompactionSummary'>;
    runtimeEventRepository: {
      listRuntimeEventsByRun(runId: string): PersistedRuntimeEvent[];
    };
  }) {}

  listMessagesBySession(sessionId: string): ReturnType<ContextSessionFactRepository['listMessagesBySession']> {
    return this.listPersistedMessages(sessionId)
      .filter((message) => message.status === 'completed' && message.content.trim().length > 0);
  }

  listSessionCompactionsBySession(
    sessionId: string,
  ): ReturnType<ContextSessionFactRepository['listSessionCompactionsBySession']> {
    return this.listPersistedCompactions(sessionId)
      .filter((compaction) => compaction.status === 'completed' && compaction.summary.trim().length > 0);
  }

  listRuntimeFactsBySession(sessionId: string): ReturnType<ContextSessionFactRepository['listRuntimeFactsBySession']> {
    return this.runtimeSourcesForSession(sessionId)
      .filter((source) => source.source_kind === 'runtime_fact')
      .map((source) => ({
        factId: source.source_id,
        text: source.text,
        ...(source.created_at ? { createdAt: source.created_at } : {}),
        ...(source.metadata ? { metadata: source.metadata } : {}),
      }));
  }

  listToolResultsBySession(sessionId: string): ReturnType<ContextSessionFactRepository['listToolResultsBySession']> {
    return this.runtimeSourcesForSession(sessionId)
      .filter((source) => source.source_kind === 'tool_result')
      .map((source) => ({
        toolResultId: source.source_id,
        text: source.text,
        ...(source.created_at ? { createdAt: source.created_at } : {}),
        ...(source.metadata ? { metadata: source.metadata } : {}),
      }));
  }

  saveContextCompaction(compaction: ContextCompaction): void {
    const activeHistory = this.activeHistory(compaction.session_id);
    const coveredEntry = findLastHistoryEntryForRefs(activeHistory, compaction.compacted_source_refs);
    if (!coveredEntry) {
      throw new Error(`Context compaction ${compaction.compaction_id} has no covered session entry.`);
    }
    const firstKeptEntry = findFirstHistoryEntryForRefsAfter(
      activeHistory,
      compaction.preserved_source_refs,
      coveredEntry.entry.entry_id,
    );

    const result = this.ports.sessionService.saveCompactionSummary({
      compaction_id: compaction.compaction_id,
      session_id: compaction.session_id,
      summary_text: compaction.summary,
      covered_until_entry_id: coveredEntry.entry.entry_id,
      ...(firstKeptEntry ? { first_kept_entry_id: firstKeptEntry.entry.entry_id } : {}),
      created_at: compaction.created_at,
      append_to_active_path: true,
    });
    if (result.status === 'failed') {
      throw new Error(result.failure.message);
    }
  }

  private runtimeSourcesForSession(sessionId: string): SessionContextSource[] {
    void sessionId;
    return [];
  }

  private listPersistedMessages(sessionId: string): PersistedSessionMessage[] {
    return this.activeHistory(sessionId)
      .flatMap((item): PersistedSessionMessage[] => item.type === 'message'
        ? [{
            messageId: item.message.message_id,
            sessionId: item.message.session_id,
            role: item.message.role,
            content: item.message.content_text,
            status: 'completed',
            createdAt: item.message.created_at,
            ...(item.message.completed_at ? { completedAt: item.message.completed_at } : {}),
          }]
        : []);
  }

  private listPersistedCompactions(sessionId: string): PersistedSessionCompaction[] {
    return this.activeHistory(sessionId)
      .flatMap((item): PersistedSessionCompaction[] => item.type === 'compaction'
        ? [{
            compactionId: item.compaction.compaction_id,
            summary: item.compaction.summary_text,
            status: 'completed',
            createdAt: item.compaction.created_at,
          }]
        : []);
  }

  private activeHistory(sessionId: string): SessionHistoryItem[] {
    const result = this.ports.sessionService.getActiveHistory({ session_id: sessionId });
    if (result.status === 'failed') {
      throw new Error(result.failure.message);
    }
    return result.history;
  }
}

function findLastHistoryEntryForRefs(history: SessionHistoryItem[], refs: ContextCompaction['compacted_source_refs']): SessionHistoryItem | undefined {
  const refKeys = new Set(refs.map((ref) => `${ref.source_kind}:${ref.source_id}`));
  return history
    .filter((item) => refKeys.has(historyItemSourceKey(item)))
    .at(-1);
}

function findFirstHistoryEntryForRefsAfter(
  history: SessionHistoryItem[],
  refs: ContextCompaction['preserved_source_refs'],
  coveredEntryId: string,
): SessionHistoryItem | undefined {
  const coveredIndex = history.findIndex((item) => item.entry.entry_id === coveredEntryId);
  const refKeys = new Set(refs.map((ref) => `${ref.source_kind}:${ref.source_id}`));
  return history
    .slice(Math.max(coveredIndex + 1, 0))
    .find((item) => refKeys.has(historyItemSourceKey(item)));
}

function historyItemSourceKey(item: SessionHistoryItem): string {
  return item.type === 'message'
    ? `session_message:${item.message.message_id}`
    : `context_compaction_summary:${item.compaction.compaction_id}`;
}

function runtimeFactText(event: PersistedRuntimeEvent): string | undefined {
  const candidates = [
    event.payload?.summary,
    event.payload?.message,
    event.payload?.reason,
    event.payload?.status,
  ];
  const text = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return text?.trim();
}

function isModelRelevantRuntimeFact(eventType: string): boolean {
  return eventType.includes('approval')
    || eventType.includes('failed')
    || eventType.includes('error')
    || eventType.includes('interrupted');
}

function isProviderContinuationStateEvent(event: PersistedRuntimeEvent): boolean {
  const serialized = JSON.stringify(event.payload ?? {});
  return event.eventType.includes('provider_state')
    || serialized.includes('previous_response_id')
    || serialized.includes('conversation_id');
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
