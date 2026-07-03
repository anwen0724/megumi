/*
 * Maps existing Coding Agent persistence records into Context module contracts.
 */
import type {
  ContextCompaction,
  ContextSessionFactRepository,
  SessionContextSource,
} from '../context';

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

type ActivePath = {
  entries: Array<{
    sourceRef: {
      sourceKind: string;
      sourceId: string;
    };
  }>;
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
    sessionRepository: {
      listMessagesBySession(sessionId: string): PersistedSessionMessage[];
      listSessionCompactionsBySession(sessionId: string): PersistedSessionCompaction[];
      saveSessionCompaction(entry: {
        compactionId: string;
        sessionId: string;
        summary: string;
        summaryKind: 'compaction';
        firstKeptSourceRef: unknown;
        tokensBefore: number;
        triggerReason: 'context_budget_pressure';
        status: 'completed';
        createdAt: string;
        metadata?: Record<string, unknown>;
      }): void;
    };
    activePathRepository: {
      getActivePath(sessionId: string): ActivePath;
    };
    runtimeEventRepository: {
      listRuntimeEventsByRun(runId: string): PersistedRuntimeEvent[];
    };
  }) {}

  listMessagesBySession(sessionId: string): ReturnType<ContextSessionFactRepository['listMessagesBySession']> {
    return this.ports.sessionRepository.listMessagesBySession(sessionId)
      .filter((message) => message.status === 'completed' && message.content.trim().length > 0);
  }

  listSessionCompactionsBySession(
    sessionId: string,
  ): ReturnType<ContextSessionFactRepository['listSessionCompactionsBySession']> {
    return this.ports.sessionRepository.listSessionCompactionsBySession(sessionId)
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
    const firstKeptSourceRef = compaction.preserved_source_refs[0];
    if (!firstKeptSourceRef) {
      throw new Error(`Context compaction ${compaction.compaction_id} has no preserved source ref.`);
    }

    this.ports.sessionRepository.saveSessionCompaction({
      compactionId: compaction.compaction_id,
      sessionId: compaction.session_id,
      summary: compaction.summary,
      summaryKind: 'compaction',
      firstKeptSourceRef: {
        sourceKind: firstKeptSourceRef.source_kind,
        sourceId: firstKeptSourceRef.source_id,
      },
      tokensBefore: compaction.usage_before.used_tokens,
      triggerReason: 'context_budget_pressure',
      status: 'completed',
      createdAt: compaction.created_at,
      metadata: compactMetadata({
        ...compaction.metadata,
        trigger: compaction.trigger,
        compacted_source_refs: compaction.compacted_source_refs,
        preserved_source_refs: compaction.preserved_source_refs,
      }),
    });
  }

  private runtimeSourcesForSession(sessionId: string): SessionContextSource[] {
    const activePath = this.ports.activePathRepository.getActivePath(sessionId);
    const runIds = activePath.entries
      .filter((entry) => entry.sourceRef.sourceKind === 'session_run')
      .map((entry) => entry.sourceRef.sourceId);

    return runIds
      .flatMap((runId) => this.ports.runtimeEventRepository.listRuntimeEventsByRun(runId))
      .map(mapRuntimeEventToRuntimeFactSource)
      .filter((source): source is SessionContextSource => !!source);
  }
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
