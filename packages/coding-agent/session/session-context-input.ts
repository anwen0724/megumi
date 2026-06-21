// Selects active-path session history, summaries, and runtime facts for model input.
import type {
  ModelInputContextSourceKind,
  ModelInputContextSourceRef,
} from '@megumi/shared/model';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { SessionCompactionEntry } from '@megumi/shared/session';
import type {
  Run,
  RunStep,
  Session,
  SessionMessage,
} from '@megumi/shared/session';
import type { SessionActivePath } from '@megumi/shared/session';
import type {
  SessionContextInput,
  SessionHistoryEntry,
  SessionHistoryEntryStatus,
  SessionRuntimeFact,
  SessionRuntimeFactKind,
  SessionRuntimeFactSeverity,
  SessionSummaryEntry,
} from '@megumi/shared/session';

export interface SessionContextInputRepository {
  getSession(sessionId: string): Session | undefined;
  getMessage(messageId: string): SessionMessage | undefined;
  getRun(runId: string): Run | undefined;
  listStepsByRun(runId: string): RunStep[];
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
  getSessionCompaction(compactionId: string): SessionCompactionEntry | null;
}

export interface SessionContextInputActivePathRepository {
  getActivePath(sessionId: string): SessionActivePath;
}

export interface BuildSessionContextInputFromRepositoryInput {
  sessionId: string;
  currentRunId?: string;
  currentMessageId?: string;
  builtAt: string;
  maxHistoryEntries?: number;
  maxRuntimeFacts?: number;
}

export interface SessionContextInputServiceOptions {
  repository: SessionContextInputRepository;
  activePathRepository: SessionContextInputActivePathRepository;
}

const DEFAULT_MAX_HISTORY_ENTRIES = 24;
const DEFAULT_MAX_RUNTIME_FACTS = 16;
const DEFAULT_UNRESOLVED_COMPACTION_BOUNDARY_HISTORY_ENTRIES = 4;
const MAX_SOURCE_ID_LENGTH = 128;

export class SessionContextInputService {
  constructor(private readonly options: SessionContextInputServiceOptions) {}

  buildSessionContextInput(input: BuildSessionContextInputFromRepositoryInput): SessionContextInput {
    const maxHistoryEntries = input.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
    const maxRuntimeFacts = input.maxRuntimeFacts ?? DEFAULT_MAX_RUNTIME_FACTS;
    const session = this.options.repository.getSession(input.sessionId);
    const activePath = this.options.activePathRepository.getActivePath(input.sessionId);
    const activePathEntries = activePath.entries;
    const latestCompletedCompaction = latestCompletedCompactionFromActivePath({
      repository: this.options.repository,
      activePath,
    });
    const completedHistoryEntries = activePathEntries
      .filter((entry) => entry.sourceRef.sourceKind === 'session_message')
      .map((entry) => this.options.repository.getMessage(entry.sourceRef.sourceId))
      .filter((message): message is SessionMessage => !!message)
      .filter((message) => message.messageId !== input.currentMessageId)
      .filter((message) => !input.currentRunId || String(message.runId) !== input.currentRunId)
      .filter(isCompletedUserOrAssistantMessage)
      .filter((message) => message.content.trim().length > 0)
      .map((message) => historyEntry(message, input.builtAt));
    const historySelection = selectHistoryForCompaction({
      historyEntries: completedHistoryEntries,
      compaction: latestCompletedCompaction,
      maxHistoryEntries,
    });
    const summaryEntries = latestCompletedCompaction
      ? [compactionSummaryEntry(latestCompletedCompaction, input.builtAt)]
      : session?.summary?.trim()
      ? [summaryEntry(session, input.builtAt)]
      : [];
    const allRuntimeFacts = activePathEntries
      .filter((entry) => entry.sourceRef.sourceKind === 'session_run')
      .map((entry) => this.options.repository.getRun(entry.sourceRef.sourceId))
      .filter((run): run is Run => !!run)
      .filter((run) => run.runId !== input.currentRunId)
      .flatMap((run) => runtimeFactsForRun({
        repository: this.options.repository,
        run,
        builtAt: input.builtAt,
      }));
    const runtimeFacts = recent(
      [
        ...filterRuntimeFactsForCompactionBoundary(allRuntimeFacts, historySelection),
        ...(historySelection.status === 'unresolved' && latestCompletedCompaction
          ? [compactionBoundaryUnresolvedFact(latestCompletedCompaction, input.builtAt)]
          : []),
      ],
      maxRuntimeFacts,
    );

    return {
      ...(historySelection.historyEntries.length > 0 ? { historyEntries: historySelection.historyEntries } : {}),
      ...(runtimeFacts.length > 0 ? { runtimeFacts } : {}),
      ...(summaryEntries.length > 0 ? { summaryEntries } : {}),
      maxHistoryEntries,
    };
  }
}

function isCompletedUserOrAssistantMessage(
  message: SessionMessage,
): message is SessionMessage & { role: 'user' | 'assistant'; status: 'completed' } {
  return (message.role === 'user' || message.role === 'assistant') && message.status === 'completed';
}

function historyEntry(
  message: SessionMessage & { role: 'user' | 'assistant'; status: 'completed' },
  builtAt: string,
): SessionHistoryEntry {
  return {
    entryId: compactId(String(message.messageId)),
    role: message.role,
    text: message.content.trim(),
    status: historyStatus(message.status),
    sourceRef: sourceRef({
      sourceId: String(message.messageId),
      sourceKind: 'session_message',
      sourceUri: `session-message://${message.messageId}`,
      builtAt,
    }),
    createdAt: message.createdAt,
    ...(message.completedAt ? { completedAt: message.completedAt } : {}),
  };
}

function historyStatus(status: SessionMessage['status']): SessionHistoryEntryStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'created':
    case 'streaming':
      return 'interrupted';
  }
}

function summaryEntry(session: Session, builtAt: string): SessionSummaryEntry {
  return {
    summaryId: compactId(`session-summary:${session.sessionId}`),
    summaryKind: 'explicit',
    text: String(session.summary).trim(),
    sourceRef: sourceRef({
      sourceId: `session-summary:${session.sessionId}`,
      sourceKind: 'session_summary',
      sourceUri: `session-summary://${session.sessionId}`,
      builtAt,
    }),
    createdAt: session.updatedAt,
  };
}

type CompactionBoundaryStatus = 'none' | 'resolved' | 'unresolved';

interface HistoryCompactionSelection {
  historyEntries: SessionHistoryEntry[];
  status: CompactionBoundaryStatus;
  firstKeptCreatedAt?: string;
}

function compactionSummaryEntry(compaction: SessionCompactionEntry, builtAt: string): SessionSummaryEntry {
  const metadata: ModelInputContextSourceRef['metadata'] = {
    compactionId: compaction.compactionId,
    ...(compaction.metadata?.previousCompactionId
      ? { previousCompactionId: compaction.metadata.previousCompactionId }
      : {}),
    ...(typeof compaction.metadata?.summarizedSourceCount === 'number'
      ? { summarizedSourceCount: compaction.metadata.summarizedSourceCount }
      : {}),
  };

  return {
    summaryId: compactId(`session-compaction:${compaction.compactionId}`),
    summaryKind: 'compaction',
    text: compaction.summary.trim(),
    sourceRef: sourceRef({
      sourceId: String(compaction.compactionId),
      sourceKind: 'session_summary',
      sourceUri: `session-compaction://${compaction.compactionId}`,
      builtAt,
      metadata,
    }),
    createdAt: compaction.createdAt,
  };
}

function latestCompletedCompactionFromActivePath(input: {
  repository: SessionContextInputRepository;
  activePath: SessionActivePath;
}): SessionCompactionEntry | null {
  for (const entry of [...input.activePath.entries].reverse()) {
    if (entry.sourceRef.sourceKind !== 'session_summary') {
      continue;
    }

    const compaction = input.repository.getSessionCompaction(entry.sourceRef.sourceId);
    if (compaction?.status === 'completed') {
      return compaction;
    }
  }

  return null;
}

function selectHistoryForCompaction(input: {
  historyEntries: SessionHistoryEntry[];
  compaction: SessionCompactionEntry | null;
  maxHistoryEntries: number;
}): HistoryCompactionSelection {
  if (!input.compaction) {
    return {
      historyEntries: recent(input.historyEntries, input.maxHistoryEntries),
      status: 'none',
    };
  }

  const compaction = input.compaction;
  const completedEntries = input.historyEntries.filter((entry) => entry.status === 'completed');
  const firstKeptIndex = completedEntries.findIndex((entry) => sourceRefsMatch(
    entry.sourceRef,
    compaction.firstKeptSourceRef,
  ));

  if (firstKeptIndex >= 0) {
    const firstKeptEntry = completedEntries[firstKeptIndex];
    return {
      historyEntries: recent(completedEntries.slice(firstKeptIndex), input.maxHistoryEntries),
      status: 'resolved',
      firstKeptCreatedAt: firstKeptEntry?.createdAt,
    };
  }

  return {
    historyEntries: recent(
      completedEntries,
      Math.min(input.maxHistoryEntries, DEFAULT_UNRESOLVED_COMPACTION_BOUNDARY_HISTORY_ENTRIES),
    ),
    status: 'unresolved',
  };
}

function sourceRefsMatch(left: ModelInputContextSourceRef, right: ModelInputContextSourceRef): boolean {
  return left.sourceKind === right.sourceKind
    && (
      left.sourceId === right.sourceId
      || (!!left.sourceUri && !!right.sourceUri && left.sourceUri === right.sourceUri)
    );
}

function runtimeFactsForRun(input: {
  repository: SessionContextInputRepository;
  run: Run;
  builtAt: string;
}): SessionRuntimeFact[] {
  const facts: SessionRuntimeFact[] = [];

  for (const event of input.repository.listRuntimeEventsByRun(String(input.run.runId))) {
    const fact = runtimeFactForEvent(event, input.builtAt);
    if (fact) {
      facts.push(fact);
    }
  }

  if (input.run.status === 'failed') {
    facts.push(runtimeFact({
      id: `session-run:${input.run.runId}:run-failed`,
      factKind: 'run_failed',
      text: `Previous run failed before a final answer.${errorSuffix(input.run.error)}`,
      sourceId: String(input.run.runId),
      sourceKind: 'session_run',
      sourceUri: `session-run://${input.run.runId}`,
      builtAt: input.builtAt,
      createdAt: input.run.completedAt ?? input.run.createdAt,
      severity: 'error',
    }));
  }

  if (input.run.status === 'cancelled') {
    facts.push(runtimeFact({
      id: `session-run:${input.run.runId}:run-cancelled`,
      factKind: 'run_cancelled',
      text: `Previous run was cancelled before a final answer.${cancelSuffix(input.run)}`,
      sourceId: String(input.run.runId),
      sourceKind: 'session_run',
      sourceUri: `session-run://${input.run.runId}`,
      builtAt: input.builtAt,
      createdAt: input.run.cancelledAt ?? input.run.completedAt ?? input.run.createdAt,
      severity: 'warning',
    }));
  }

  for (const step of input.repository.listStepsByRun(String(input.run.runId))) {
    if (step.status === 'failed') {
      facts.push(runtimeFact({
        id: `session-step:${step.stepId}:step-failed`,
        factKind: 'step_failed',
        text: `Run step failed: ${step.title ?? step.kind}.${errorSuffix(step.error)}`,
        sourceId: String(step.stepId),
        sourceKind: 'session_step',
        sourceUri: `session-step://${step.stepId}`,
        builtAt: input.builtAt,
        createdAt: step.completedAt ?? step.startedAt,
        severity: 'error',
      }));
    }
  }

  return facts;
}

function filterRuntimeFactsForCompactionBoundary(
  facts: SessionRuntimeFact[],
  historySelection: HistoryCompactionSelection,
): SessionRuntimeFact[] {
  if (historySelection.status !== 'resolved' || !historySelection.firstKeptCreatedAt) {
    return facts;
  }

  return facts.filter((fact) => !fact.createdAt || fact.createdAt >= historySelection.firstKeptCreatedAt!);
}

function compactionBoundaryUnresolvedFact(
  compaction: SessionCompactionEntry,
  builtAt: string,
): SessionRuntimeFact {
  return runtimeFact({
    id: `${compaction.compactionId}:boundary-unresolved`,
    factKind: 'other',
    text: 'Compaction boundary could not be resolved; retained latest compaction summary and a small recent history window.',
    sourceId: `${compaction.compactionId}:boundary-unresolved`,
    sourceKind: 'session_summary',
    sourceUri: `session-compaction://${compaction.compactionId}/boundary-unresolved`,
    builtAt,
    createdAt: builtAt,
    severity: 'warning',
  });
}

function runtimeFactForEvent(event: RuntimeEvent, builtAt: string): SessionRuntimeFact | undefined {
  if (event.eventType === 'tool.result.created') {
    const summary = stringPayloadField(event, 'summary')?.trim();
    if (summary) {
      const semantics = toolResultFactSemantics(stringPayloadField(event, 'kind'));
      return runtimeFact({
        id: `runtime-event:${event.eventId}`,
        factKind: semantics.factKind,
        text: `Tool result: ${summary}`,
        sourceKind: 'tool_result',
        sourceUri: `runtime-event://${event.eventId}`,
        builtAt,
        createdAt: event.createdAt,
        severity: semantics.severity,
      });
    }
  }

  if (event.eventType === 'tool.execution.denied') {
    const reason = stringPayloadField(event, 'reason')?.trim();
    if (reason) {
      return runtimeFact({
        id: `runtime-event:${event.eventId}`,
        factKind: 'approval',
        text: `Tool call denied: ${reason}`,
        sourceKind: 'approval',
        sourceUri: `runtime-event://${event.eventId}`,
        builtAt,
        createdAt: event.createdAt,
        severity: 'warning',
      });
    }
  }

  if (event.eventType === 'approval.resolved') {
    const decision = stringPayloadField(event, 'decision')?.trim();
    if (decision) {
      return runtimeFact({
        id: `runtime-event:${event.eventId}`,
        factKind: 'approval',
        text: `Approval resolved: ${decision}`,
        sourceKind: 'approval',
        sourceUri: `runtime-event://${event.eventId}`,
        builtAt,
        createdAt: event.createdAt,
        severity: decision === 'approved' ? 'info' : 'warning',
      });
    }
  }

  return undefined;
}

function toolResultFactSemantics(kind: string | undefined): {
  factKind: SessionRuntimeFactKind;
  severity: SessionRuntimeFactSeverity;
} {
  switch (kind) {
    case 'tool_error':
      return { factKind: 'tool_error', severity: 'error' };
    case 'policy_denied':
    case 'user_rejected':
      return { factKind: 'approval', severity: 'warning' };
    case 'redacted':
      return { factKind: 'tool_result', severity: 'warning' };
    case 'success':
    default:
      return { factKind: 'tool_result', severity: 'info' };
  }
}

function runtimeFact(input: {
  id: string;
  factKind: SessionRuntimeFactKind;
  text: string;
  sourceId?: string;
  sourceKind: ModelInputContextSourceKind;
  sourceUri: string;
  builtAt: string;
  createdAt?: string;
  severity: SessionRuntimeFactSeverity;
}): SessionRuntimeFact {
  return {
    factId: compactId(input.id),
    factKind: input.factKind,
    text: input.text,
    sourceRef: sourceRef({
      sourceId: input.sourceId ?? input.id,
      sourceKind: input.sourceKind,
      sourceUri: input.sourceUri,
      builtAt: input.builtAt,
    }),
    severity: input.severity,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  };
}

function sourceRef(input: {
  sourceId: string;
  sourceKind: ModelInputContextSourceKind;
  sourceUri: string;
  builtAt: string;
  metadata?: ModelInputContextSourceRef['metadata'];
}): ModelInputContextSourceRef {
  return {
    sourceId: compactId(input.sourceId),
    sourceKind: input.sourceKind,
    sourceUri: input.sourceUri,
    loadedAt: input.builtAt,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function stringPayloadField(event: RuntimeEvent, field: string): string | undefined {
  const value = (event.payload as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function errorSuffix(error: RuntimeError | undefined): string {
  return error?.message ? ` Error: ${error.message}` : '';
}

function cancelSuffix(run: Run): string {
  const reason = typeof run.metadata?.reason === 'string' ? ` Reason: ${run.metadata.reason}` : '';
  return `${reason}${errorSuffix(run.error)}`;
}

function recent<T>(items: T[], maxItems: number): T[] {
  return items.length > maxItems ? items.slice(items.length - maxItems) : items;
}

function compactId(value: string): string {
  if (value.length <= MAX_SOURCE_ID_LENGTH) {
    return value;
  }

  const suffix = `:${stableHash(value)}`;
  return `${value.slice(0, MAX_SOURCE_ID_LENGTH - suffix.length)}${suffix}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

