/* Renders product Trace summaries without consulting business-state projections. */
import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import type { ObservabilityTraceSummaryUiDto } from '@megumi/product-host/host';
import { useTranslation } from 'react-i18next';
import { cx } from '../../shared/ui';
import {
  formatTraceDuration,
  formatTraceTime,
  primaryCorrelation,
  traceAccessibleName,
} from './diagnostics-format';

interface TraceListProps {
  readonly traces: readonly ObservabilityTraceSummaryUiDto[];
  readonly selectedTraceId?: string;
  readonly emptyLabel: string;
  readonly onSelect: (traceId: string) => void;
}

export function TraceList({ traces, selectedTraceId, emptyLabel, onSelect }: TraceListProps) {
  const { t } = useTranslation('settings');
  if (traces.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">{emptyLabel}</div>;
  }
  return (
    <div className="divide-y divide-[var(--color-border)]">
      {traces.map((trace) => (
        <button
          key={trace.traceId}
          type="button"
          aria-label={traceAccessibleName(trace)}
          onClick={() => onSelect(trace.traceId)}
          className={cx(
            'group w-full px-4 py-3 text-left transition-colors',
            selectedTraceId === trace.traceId
              ? 'bg-[var(--color-surface-muted)]'
              : 'hover:bg-[var(--color-surface-muted)]/60',
          )}
        >
          <div className="flex items-start gap-3">
            <StatusIcon status={trace.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-xs font-semibold text-[var(--color-text)]">
                  {trace.traceId}
                </span>
                <span className="shrink-0 font-mono text-[0.68rem] text-[var(--color-text-muted)]">
                  {formatTraceDuration(trace.durationMs)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-medium">
                  {trace.traceKind}
                </span>
                <span className="truncate">{primaryCorrelation(trace.correlation)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 text-[0.7rem] text-[var(--color-text-muted)]">
                <span>{formatTraceTime(trace.startedAt)}</span>
                <span>{t('diagnostics.traceCounts', {
                  spans: trace.spanCount,
                  content: trace.contentCount,
                  issues: trace.issueCount,
                })}</span>
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function StatusIcon({ status }: { readonly status: ObservabilityTraceSummaryUiDto['status'] }) {
  const common = 'mt-0.5 size-4 shrink-0';
  if (status === 'ok') return <CheckCircle2 className={cx(common, 'text-[var(--color-success)]')} />;
  if (status === 'error') return <XCircle className={cx(common, 'text-[var(--color-danger)]')} />;
  if (status === 'cancelled') return <CircleSlash className={cx(common, 'text-[var(--color-text-muted)]')} />;
  return <AlertTriangle className={cx(common, 'text-[var(--color-warning)]')} />;
}
