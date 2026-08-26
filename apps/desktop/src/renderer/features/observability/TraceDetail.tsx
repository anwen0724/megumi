/* Renders one projected Trace as timing, sequence, correlation, and diagnostic evidence. */
import { AlertTriangle, ArrowUpRight, GitBranch, TimerReset } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, type ReactNode } from 'react';
import type {
  ObservabilityGetContentResult,
  ObservabilitySpanUiDto,
  ObservabilityTraceDetailUiDto,
} from '@megumi/product-host/host';
import { correlationEntries, formatTraceDuration, formatTraceTime } from './diagnostics-format';
import { TraceContentViewer } from './TraceContentViewer';

interface TraceDetailProps {
  readonly trace: ObservabilityTraceDetailUiDto;
  readonly contentBySequence: Readonly<Record<number, ObservabilityGetContentResult | 'loading'>>;
  readonly onReadContent: (sequence: number) => void;
}

export function TraceDetail({ trace, contentBySequence, onReadContent }: TraceDetailProps) {
  const { t } = useTranslation('settings');
  const [spanFilter, setSpanFilter] = useState('all');
  const [contentFilter, setContentFilter] = useState('all');
  const spanNames = [...new Set(trace.spans.map((span) => span.name))];
  const contentKinds = [...new Set(trace.contents.map((content) => content.kind))];
  const displayedSpans = trace.spans.filter((span) => (
    spanFilter === 'all' || span.name === spanFilter
  ));
  const displayedContents = trace.contents.filter((content) => (
    contentFilter === 'all' || content.kind === contentFilter
  ));
  const timeline = [
    ...displayedSpans.flatMap((span) => span.events.map((event) => ({
      kind: 'event' as const, event, spanName: span.name,
    }))),
    ...displayedContents.map((content) => ({ kind: 'content' as const, content })),
  ].sort((left, right) => sequenceOf(left) - sequenceOf(right));

  return (
    <div className="min-w-0 space-y-5 p-5">
      <header className="border-b border-[var(--color-border)] pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              {trace.summary.traceKind}
            </div>
            <h3 className="mt-1 break-all font-mono text-sm font-semibold text-[var(--color-text)]">
              {trace.summary.traceId}
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-[var(--color-border)] px-2 py-1 font-medium text-[var(--color-text)]">
              {trace.summary.status}
            </span>
            <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-1 text-[var(--color-text-muted)]">
              {trace.summary.diagnostics}
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {correlationEntries(trace.summary.correlation).map(([key, value]) => (
            <span key={key} className="rounded bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-[0.68rem] text-[var(--color-text-muted)]">
              {key}={value}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-text-muted)]">
          <span>{formatTraceTime(trace.summary.startedAt)}</span>
          <span>{formatTraceDuration(trace.summary.durationMs)}</span>
          <span>{trace.summary.spanCount} spans</span>
          <span>{trace.summary.eventCount} events</span>
          <span>{trace.summary.contentCount} content</span>
        </div>
      </header>

      <div className="grid gap-3 rounded-lg bg-[var(--color-surface-muted)] p-3 sm:grid-cols-2">
        <DetailFilter
          label={t('diagnostics.spanFilter')}
          value={spanFilter}
          allLabel={t('diagnostics.allSpans')}
          options={spanNames}
          onChange={setSpanFilter}
        />
        <DetailFilter
          label={t('diagnostics.contentFilter')}
          value={contentFilter}
          allLabel={t('diagnostics.allContent')}
          options={contentKinds}
          onChange={setContentFilter}
        />
      </div>

      <section>
        <SectionTitle icon={<TimerReset size={15} />} title={t('diagnostics.spanTree')} />
        <div className="mt-2 overflow-hidden rounded-lg border border-[var(--color-border)]">
          {displayedSpans.map((span) => (
            <SpanRow key={span.spanId} span={span} trace={trace} />
          ))}
          {displayedSpans.length === 0 ? <EmptyLine label={t('diagnostics.noSpans')} /> : null}
        </div>
      </section>

      <section>
        <SectionTitle icon={<GitBranch size={15} />} title={t('diagnostics.sequenceTimeline')} />
        <div className="mt-2 space-y-2">
          {timeline.map((item) => item.kind === 'event' ? (
            <div key={`event:${item.event.sequence}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[0.65rem] text-[var(--color-text-muted)]">
                  #{item.event.sequence} · event
                </span>
                <span className="font-mono text-xs font-semibold text-[var(--color-text)]">
                  {item.event.type}
                </span>
                <span className="text-[0.68rem] text-[var(--color-text-muted)]">{item.spanName}</span>
              </div>
              {Object.keys(item.event.detail).length > 0 ? (
                <pre className="mt-2 overflow-auto font-mono text-[0.7rem] text-[var(--color-text-muted)]">
                  {JSON.stringify(item.event.detail, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : (
            <TraceContentViewer
              key={`content:${item.content.sequence}`}
              checkpoint={item.content}
              result={contentBySequence[item.content.sequence]}
              onRead={() => onReadContent(item.content.sequence)}
              labels={{
                view: t('diagnostics.viewContent'),
                loading: t('diagnostics.loadingContent'),
                binary: t('diagnostics.binaryContent'),
                unavailable: t('diagnostics.contentUnavailable'),
              }}
            />
          ))}
          {timeline.length === 0 ? <EmptyLine label={t('diagnostics.noTimeline')} /> : null}
        </div>
      </section>

      {trace.links.length > 0 ? (
        <section>
          <SectionTitle icon={<ArrowUpRight size={15} />} title={t('diagnostics.traceLinks')} />
          <div className="mt-2 space-y-1.5">
            {trace.links.map((link) => (
              <div key={`${link.sequence}:${link.targetTraceId}`} className="rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono text-xs text-[var(--color-text)]">
                #{link.sequence} · {link.linkKind} → {link.targetTraceId}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {trace.issues.length > 0 ? (
        <section>
          <SectionTitle icon={<AlertTriangle size={15} />} title={t('diagnostics.issues')} />
          <div className="mt-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-3">
            {trace.issues.map((issue, index) => (
              <div key={`${issue.code}:${issue.sequence ?? index}`} className="font-mono text-xs text-[var(--color-text)]">
                {issue.code}{issue.sequence === undefined ? '' : ` · #${issue.sequence}`}
                {issue.spanId ? ` · ${issue.spanId}` : ''}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SpanRow({
  span,
  trace,
}: {
  readonly span: ObservabilitySpanUiDto;
  readonly trace: ObservabilityTraceDetailUiDto;
}) {
  const traceStart = Date.parse(trace.summary.startedAt ?? span.startedAt);
  const traceEnd = Date.parse(trace.summary.endedAt ?? span.endedAt ?? span.startedAt);
  const spanStart = Date.parse(span.startedAt);
  const spanEnd = Date.parse(span.endedAt ?? span.startedAt);
  const total = Math.max(1, traceEnd - traceStart);
  const left = Math.max(0, Math.min(100, ((spanStart - traceStart) / total) * 100));
  const width = Math.max(1, Math.min(100 - left, ((spanEnd - spanStart) / total) * 100));
  return (
    <div className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(10rem,1.2fr)_4.5rem] items-center gap-3 border-b border-[var(--color-border)] px-3 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate font-mono text-xs font-semibold text-[var(--color-text)]">{span.name}</div>
        <div className="mt-0.5 truncate font-mono text-[0.65rem] text-[var(--color-text-muted)]">{span.spanId}</div>
      </div>
      <div className="relative h-2 rounded-full bg-[var(--color-surface-muted)]">
        <div
          className="absolute top-0 h-2 rounded-full bg-[var(--color-accent)]/75"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
      <div className="text-right font-mono text-[0.68rem] text-[var(--color-text-muted)]">
        {formatTraceDuration(span.durationMs)}
      </div>
    </div>
  );
}

function SectionTitle({ icon, title }: { readonly icon: ReactNode; readonly title: string }) {
  return (
    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
      {icon}{title}
    </h4>
  );
}

function EmptyLine({ label }: { readonly label: string }) {
  return <div className="px-3 py-5 text-center text-xs text-[var(--color-text-muted)]">{label}</div>;
}

function DetailFilter({
  label, value, allLabel, options, onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly allLabel: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[0.68rem] font-medium text-[var(--color-text-muted)]">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 font-mono text-xs text-[var(--color-text)]">
        <option value="all">{allLabel}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function sequenceOf(item: {
  readonly kind: 'event'; readonly event: { readonly sequence: number };
} | {
  readonly kind: 'content'; readonly content: { readonly sequence: number };
}): number {
  return item.kind === 'event' ? item.event.sequence : item.content.sequence;
}
