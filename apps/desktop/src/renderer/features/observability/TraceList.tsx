/* Renders human-readable Trace summaries grouped by Session or Daily Discovery day. */
import { useState } from 'react';
import {
  AlertTriangle,
  CalendarSearch,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  MessagesSquare,
  XCircle,
} from 'lucide-react';
import type { ObservabilityTraceSummaryUiDto } from '@megumi/product-host/host';
import { useTranslation } from 'react-i18next';
import { cx } from '../../shared/ui';
import { formatTraceDuration, formatTraceTime } from './diagnostics-format';
import type { TraceDisplayGroup, TraceDisplayItem } from './trace-display';

interface TraceListProps {
  readonly groups: readonly TraceDisplayGroup[];
  readonly selectedTraceId?: string;
  readonly emptyLabel: string;
  readonly onSelect: (item: TraceDisplayItem) => void;
}

export function TraceList({ groups, selectedTraceId, emptyLabel, onSelect }: TraceListProps) {
  const { t } = useTranslation('settings');
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  if (groups.length === 0) {
    return <div className="px-5 py-12 text-center text-sm text-[var(--color-text-muted)]">{emptyLabel}</div>;
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <div className="space-y-2 p-2">
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.id);
        return (
          <section key={group.id} className="overflow-hidden rounded-xl border border-transparent">
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={() => toggleGroup(group.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)] active:bg-[var(--color-accent-soft)]"
            >
              {group.kind === 'conversation'
                ? <MessagesSquare size={14} className="shrink-0 text-[var(--color-accent)]" />
                : <CalendarSearch size={14} className="shrink-0 text-[var(--color-accent)]" />}
              <span className="min-w-0 flex-1 truncate">
                {group.kind === 'conversation' ? (
                  <>
                    <span className="text-[var(--color-text-muted)]">{t('diagnostics.traceKinds.conversation')} · </span>
                    <span>{group.title}</span>
                  </>
                ) : <span>{group.title}</span>}
              </span>
              <span className="shrink-0 text-[0.66rem] font-normal text-[var(--color-text-muted)]">
                {t('diagnostics.groupTraceCount', { count: group.items.length })}
              </span>
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={cx('shrink-0 transition-transform duration-150', collapsed && '-rotate-90')}
              />
            </button>

            {!collapsed ? (
              <div className="mt-1 space-y-1">
                {group.items.map((item) => (
                  <TraceListItem
                    key={item.summary.traceId}
                    item={item}
                    selected={selectedTraceId === item.summary.traceId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function TraceListItem({
  item,
  selected,
  onSelect,
}: {
  readonly item: TraceDisplayItem;
  readonly selected: boolean;
  readonly onSelect: (item: TraceDisplayItem) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <button
      type="button"
      aria-label={`${item.title} · ${item.groupTitle} · ${t(`diagnostics.status.${item.summary.status}`)}`}
      aria-pressed={selected}
      onClick={() => onSelect(item)}
      className={cx(
        'group relative w-full rounded-xl border px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.995]',
        selected
          ? 'border-[var(--color-accent)]/35 bg-[var(--color-accent-soft)] shadow-sm'
          : 'border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]/70',
      )}
    >
      <span className={cx(
        'absolute inset-y-2 left-0 w-0.5 rounded-full transition-colors',
        selected ? 'bg-[var(--color-accent)]' : 'bg-transparent',
      )} />
      <div className="flex items-start gap-2.5">
        <StatusIcon status={item.summary.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--color-text)]">{item.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] text-[var(--color-text-muted)]">
            <span>{formatTraceTime(item.summary.startedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{t(`diagnostics.status.${item.summary.status}`)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{formatTraceDuration(item.summary.durationMs)}</span>
          </div>
          {item.summary.issueCount > 0 ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-[0.68rem] font-medium text-[var(--color-warning)]">
              <AlertTriangle size={12} aria-hidden="true" />
              {t('diagnostics.diagnosticIssueCount', { count: item.summary.issueCount })}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function StatusIcon({ status }: { readonly status: ObservabilityTraceSummaryUiDto['status'] }) {
  const common = 'mt-0.5 size-4 shrink-0';
  if (status === 'ok') return <CheckCircle2 className={cx(common, 'text-[var(--color-success)]')} />;
  if (status === 'error') return <XCircle className={cx(common, 'text-[var(--color-danger)]')} />;
  if (status === 'cancelled') return <CircleSlash className={cx(common, 'text-[var(--color-text-muted)]')} />;
  return <AlertTriangle className={cx(common, 'text-[var(--color-warning)]')} />;
}
