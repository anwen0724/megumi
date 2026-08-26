/*
 * Builds human-readable Trace list items from Observability facts plus optional Session metadata.
 */
import type {
  ObservabilityTraceSummaryUiDto,
  SessionDto,
  UserMessageSummaryDto,
} from '@megumi/product-host/host';

export interface TraceDisplayLabels {
  readonly conversationFallback: string;
  readonly deletedSession: string;
  readonly unassignedSession: string;
  readonly dailyDiscovery: string;
  readonly scheduledDiscovery: string;
  readonly candidateSupply: string;
  readonly candidateSupplyRun: string;
}

export interface TraceDisplayItem {
  readonly summary: ObservabilityTraceSummaryUiDto;
  readonly title: string;
  readonly groupId: string;
  readonly groupTitle: string;
  readonly groupKind: 'conversation' | 'daily_discovery' | 'candidate_supply';
  readonly sessionId?: string;
}

export interface TraceDisplayGroup {
  readonly id: string;
  readonly title: string;
  readonly kind: 'conversation' | 'daily_discovery' | 'candidate_supply';
  readonly items: readonly TraceDisplayItem[];
}

export interface TraceDisplayFilters {
  readonly query: string;
  readonly traceKind: 'all' | 'conversation' | 'daily_discovery' | 'candidate_supply';
  readonly sessionId: string;
  readonly status: 'all' | ObservabilityTraceSummaryUiDto['status'];
  readonly issuesOnly: boolean;
}

/** Enriches Trace summaries for display without changing the Observability source of truth. */
export function createTraceDisplayItems(input: {
  readonly traces: readonly ObservabilityTraceSummaryUiDto[];
  readonly sessions: readonly SessionDto[];
  readonly messages: readonly UserMessageSummaryDto[];
  readonly labels: TraceDisplayLabels;
  readonly locale?: string;
}): readonly TraceDisplayItem[] {
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const messagesByExecutionId = new Map(
    input.messages.flatMap((message) => (
      message.role === 'user' && message.executionId ? [[message.executionId, message] as const] : []
    )),
  );
  const messagesById = new Map(
    input.messages.filter((message) => message.role === 'user').map((message) => [message.id, message]),
  );

  return input.traces.map((summary) => {
    if (summary.traceKind === 'daily_discovery') {
      const day = formatTraceDay(summary.startedAt, input.locale);
      return {
        summary,
        title: input.labels.scheduledDiscovery,
        groupId: `daily:${day}`,
        groupTitle: `${input.labels.dailyDiscovery} · ${day}`,
        groupKind: 'daily_discovery',
      };
    }
    if (summary.traceKind === 'candidate_supply') {
      const day = formatTraceDay(summary.startedAt, input.locale);
      return {
        summary,
        title: input.labels.candidateSupplyRun,
        groupId: `candidate-supply:${day}`,
        groupTitle: `${input.labels.candidateSupply} · ${day}`,
        groupKind: 'candidate_supply',
      };
    }

    const sessionId = summary.correlation.sessionId;
    const session = sessionId ? sessionsById.get(sessionId) : undefined;
    const message = (
      summary.correlation.executionId
        ? messagesByExecutionId.get(summary.correlation.executionId)
        : undefined
    ) ?? (
      summary.correlation.messageId ? messagesById.get(summary.correlation.messageId) : undefined
    );
    const groupTitle = session?.title.trim()
      || (sessionId ? input.labels.deletedSession : input.labels.unassignedSession);
    return {
      summary,
      title: preview(message?.text) ?? input.labels.conversationFallback,
      groupId: `session:${sessionId ?? 'unassigned'}`,
      groupTitle,
      groupKind: 'conversation',
      ...(sessionId ? { sessionId } : {}),
    };
  });
}

/** Applies human-facing filters locally so control changes take effect immediately. */
export function filterTraceDisplayItems(
  items: readonly TraceDisplayItem[],
  filters: TraceDisplayFilters,
): readonly TraceDisplayItem[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (filters.traceKind !== 'all' && item.summary.traceKind !== filters.traceKind) return false;
    if (
      (filters.traceKind === 'all' || filters.traceKind === 'conversation')
      && filters.sessionId !== 'all'
      && item.sessionId !== filters.sessionId
    ) return false;
    if (filters.status !== 'all' && item.summary.status !== filters.status) return false;
    if (filters.issuesOnly && item.summary.issueCount === 0) return false;
    if (!query) return true;
    return searchableText(item).includes(query);
  });
}

/** Groups filtered items by Session or Daily Discovery day in latest-first order. */
export function groupTraceDisplayItems(items: readonly TraceDisplayItem[]): readonly TraceDisplayGroup[] {
  const groups = new Map<string, TraceDisplayItem[]>();
  for (const item of items) {
    const group = groups.get(item.groupId) ?? [];
    group.push(item);
    groups.set(item.groupId, group);
  }
  return [...groups.entries()].map(([id, groupItems]) => {
    const sortedItems = [...groupItems].sort(compareTraceItems);
    const first = sortedItems[0];
    if (!first) throw new Error(`Trace display group ${id} has no items.`);
    return { id, title: first.groupTitle, kind: first.groupKind, items: sortedItems };
  }).sort((left, right) => compareTraceItems(left.items[0], right.items[0]));
}

function searchableText(item: TraceDisplayItem): string {
  const correlations = Object.values(item.summary.correlation).flatMap((value) => (
    value === undefined ? [] : [Array.isArray(value) ? value.join(' ') : String(value)]
  ));
  return [item.title, item.groupTitle, item.summary.traceId, ...correlations]
    .join(' ')
    .toLocaleLowerCase();
}

function preview(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 72 ? `${normalized.slice(0, 71)}…` : normalized;
}

function formatTraceDay(value: string | undefined, locale: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

function compareTraceItems(
  left: TraceDisplayItem | undefined,
  right: TraceDisplayItem | undefined,
): number {
  return (right?.summary.startedAt ?? '').localeCompare(left?.summary.startedAt ?? '')
    || (left?.summary.traceId ?? '').localeCompare(right?.summary.traceId ?? '');
}
