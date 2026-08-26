/* Pure display helpers for the Trace diagnostics console. */
import type {
  ObservabilityCorrelationUiDto,
  ObservabilityTraceSummaryUiDto,
} from '@megumi/product-host/host';

export function formatTraceDuration(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

export function formatTraceTime(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

export function primaryCorrelation(correlation: ObservabilityCorrelationUiDto): string {
  const entries = correlationEntries(correlation);
  return entries[0] ? `${entries[0][0]} · ${entries[0][1]}` : '—';
}

export function correlationEntries(
  correlation: ObservabilityCorrelationUiDto,
): readonly (readonly [string, string])[] {
  return Object.entries(correlation).flatMap(([key, value]) => {
    if (value === undefined) return [];
    return [[key, Array.isArray(value) ? value.join(', ') : String(value)] as const];
  });
}

export function traceAccessibleName(summary: ObservabilityTraceSummaryUiDto): string {
  return `${summary.traceId} ${summary.traceKind} ${summary.status}`;
}

export function correlationFromFilter(value: string): ObservabilityCorrelationUiDto | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const key = CORRELATION_PREFIXES.find(([prefix]) => normalized.startsWith(prefix))?.[1]
    ?? 'executionId';
  return { [key]: normalized };
}

const CORRELATION_PREFIXES = [
  ['request:', 'requestId'], ['execution:', 'executionId'], ['session:', 'sessionId'],
  ['message:', 'messageId'], ['workspace:', 'workspaceId'], ['batch:', 'batchId'],
  ['source:', 'sourceId'], ['candidate:', 'candidateId'],
  ['recommendation:', 'recommendationId'],
] as const satisfies readonly (readonly [string, keyof ObservabilityCorrelationUiDto])[];
