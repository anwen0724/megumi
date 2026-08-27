/* Renders one Trace as a human-readable execution flow with optional timing and technical evidence. */
import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleSlash,
  Copy,
  Download,
  GitBranch,
  TimerReset,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  ObservabilityContentCheckpointUiDto,
  ObservabilityGetContentResult,
  ObservabilitySpanUiDto,
  ObservabilityTraceDetailUiDto,
} from '@megumi/product-host/host';
import { Button, Tabs, cx } from '../../shared/ui';
import { correlationEntries, formatTraceDuration, formatTraceTime } from './diagnostics-format';
import type { TraceDisplayItem } from './trace-display';
import { TraceContentViewer } from './TraceContentViewer';

interface TraceDetailProps {
  readonly trace: ObservabilityTraceDetailUiDto;
  readonly display: TraceDisplayItem;
  readonly contentBySequence: Readonly<Record<number, ObservabilityGetContentResult | 'loading'>>;
  readonly exportLoading: boolean;
  readonly onReadContent: (sequence: number) => void;
  readonly onExport: () => void;
}

type DetailView = 'flow' | 'timing';

export function TraceDetail({
  trace,
  display,
  contentBySequence,
  exportLoading,
  onReadContent,
  onExport,
}: TraceDetailProps) {
  const { t } = useTranslation('settings');
  const [view, setView] = useState<DetailView>('flow');
  const [highlightedSequence, setHighlightedSequence] = useState<number>();
  const roots = useMemo(() => trace.spans.filter((span) => (
    !span.parentSpanId || !trace.spans.some((candidate) => candidate.spanId === span.parentSpanId)
  )), [trace.spans]);
  const rootContents = trace.contents.filter((content) => !content.spanId);
  const modelCallCount = trace.spans.filter((span) => span.name === 'model.call').length;
  const toolCallCount = trace.spans.filter((span) => span.name === 'tool.call').length;

  function locateSequence(sequence: number | undefined) {
    if (sequence === undefined) return;
    setView('flow');
    setHighlightedSequence(sequence);
    window.setTimeout(() => {
      document.getElementById(`trace-content-${sequence}`)?.scrollIntoView?.({
        behavior: 'smooth', block: 'center',
      });
    }, 0);
  }

  async function copyTraceId() {
    try {
      await navigator.clipboard.writeText(trace.summary.traceId);
    } catch {
      // The visible ID remains selectable when clipboard permission is unavailable.
    }
  }

  return (
    <div className="min-w-0">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              {t('diagnostics.traceLabel', { kind: traceKindName(trace.summary.traceKind, t) })}
            </div>
            <h3 className="mt-1.5 truncate text-xl font-semibold tracking-[-0.02em] text-[var(--color-text)]">
              {display.title}
            </h3>
            {trace.summary.traceKind === 'conversation' ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
                {t('diagnostics.userSent', { text: display.title })}
              </p>
            ) : null}
          </div>
          <Button size="sm" variant="secondary" disabled={exportLoading} onClick={onExport}>
            <Download size={14} aria-hidden="true" className={cx(exportLoading && 'animate-pulse')} />
            {exportLoading ? t('diagnostics.exporting') : t('diagnostics.export')}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={trace.summary.status} />
          <span className={cx(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            trace.summary.diagnostics === 'complete'
              ? 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]'
              : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
          )}>
            {trace.summary.diagnostics === 'complete'
              ? t('diagnostics.diagnosticsComplete')
              : t('diagnostics.diagnosticsIncomplete', { count: trace.summary.issueCount })}
          </span>
          <span className="ml-1 text-xs text-[var(--color-text-muted)]">{formatTraceTime(trace.summary.startedAt)}</span>
          <span className="text-xs text-[var(--color-text-muted)]">·</span>
          <span className="font-mono text-xs text-[var(--color-text-muted)]">{formatTraceDuration(trace.summary.durationMs)}</span>
        </div>

        <div className="mt-3 text-xs font-medium text-[var(--color-text-muted)]">
          {t('diagnostics.invocationCounts', { modelCount: modelCallCount, toolCount: toolCallCount })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[0.68rem] text-[var(--color-text-muted)]">
          <span className="font-mono">
            {t('diagnostics.traceIdLabel', { traceId: shortId(trace.summary.traceId) })}
          </span>
          <button
            type="button"
            aria-label={t('diagnostics.copyTraceId')}
            onClick={() => void copyTraceId()}
            className="rounded p-1 transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] active:scale-95"
          >
            <Copy size={12} aria-hidden="true" />
          </button>
        </div>

        <details className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/35 px-3.5 py-2.5 text-xs">
          <summary className="cursor-pointer select-none font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {t('diagnostics.technicalIdentifiers')}
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {correlationEntries(trace.summary.correlation).map(([key, value]) => (
              <div key={key} className="min-w-0 rounded-lg bg-[var(--color-surface)] px-3 py-2">
                <div className="text-[0.64rem] font-medium text-[var(--color-text-muted)]">{key}</div>
                <div className="mt-0.5 truncate font-mono text-[0.68rem] text-[var(--color-text)]" title={value}>{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-2.5 text-[0.68rem] text-[var(--color-text-muted)]">
            <span>{t('diagnostics.spanCount', { count: trace.summary.spanCount })}</span>
            <span>{t('diagnostics.eventCount', { count: trace.summary.eventCount })}</span>
            <span>{t('diagnostics.contentCount', { count: trace.summary.contentCount })}</span>
          </div>
        </details>
      </header>

      <div className="space-y-5 p-5">
        {trace.issues.length > 0 ? (
          <DiagnosticIssues issues={trace.issues} onLocate={locateSequence} />
        ) : null}

        <Tabs
          ariaLabel={t('diagnostics.detailViews')}
          value={view}
          onValueChange={setView}
          tabs={[
            { id: 'flow', label: t('diagnostics.executionFlow') },
            { id: 'timing', label: t('diagnostics.timingAnalysis') },
          ]}
        />

        {view === 'flow' ? (
          <section aria-label={t('diagnostics.executionFlow')}>
            <SectionTitle icon={<GitBranch size={15} />} title={t('diagnostics.executionFlow')} />
            <div className="mt-3 space-y-3">
              {rootContents.map((content) => (
                <ContentCheckpoint
                  key={content.sequence}
                  checkpoint={content}
                  result={contentBySequence[content.sequence]}
                  highlighted={highlightedSequence === content.sequence}
                  onReadContent={onReadContent}
                />
              ))}
              {roots.map((span) => (
                <SpanNode
                  key={span.spanId}
                  span={span}
                  trace={trace}
                  contentBySequence={contentBySequence}
                  highlightedSequence={highlightedSequence}
                  onReadContent={onReadContent}
                />
              ))}
              {roots.length === 0 && rootContents.length === 0 ? (
                <EmptyLine label={t('diagnostics.noExecutionFlow')} />
              ) : null}
            </div>
          </section>
        ) : (
          <TimingAnalysis trace={trace} />
        )}

        {trace.links.length > 0 ? (
          <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
              <ArrowUpRight size={14} />{t('diagnostics.traceLinks')}
            </summary>
            <div className="mt-3 space-y-1.5">
              {trace.links.map((link) => (
                <div key={`${link.sequence}:${link.targetTraceId}`} className="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-xs text-[var(--color-text)]">
                  #{link.sequence} · {link.linkKind} → {link.targetTraceId}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function DiagnosticIssues({
  issues,
  onLocate,
}: {
  readonly issues: ObservabilityTraceDetailUiDto['issues'];
  readonly onLocate: (sequence: number | undefined) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <section className="rounded-xl border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-[var(--color-warning)]/10 p-2 text-[var(--color-warning)]">
          <AlertTriangle size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">{t('diagnostics.diagnosticDataIncomplete')}</h4>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
            {t('diagnostics.diagnosticIssueDoesNotAffectExecution')}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {issues.map((issue, index) => (
          <article key={`${issue.code}:${issue.sequence ?? index}`} className="rounded-lg border border-[var(--color-warning)]/20 bg-[var(--color-surface)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[var(--color-text)]">
                  {issueTitle(issue, t)}
                </div>
                {issue.code === 'partial_content_capture' ? (
                  <div className="mt-1 text-[0.7rem] text-[var(--color-warning)]">
                    {t('diagnostics.partialCaptureCount', { count: issue.captureIssues?.length ?? 0 })}
                  </div>
                ) : null}
              </div>
              {issue.sequence !== undefined ? (
                <Button size="sm" variant="ghost" onClick={() => onLocate(issue.sequence)}>
                  {t('diagnostics.locateRecord', { sequence: issue.sequence })}
                </Button>
              ) : null}
            </div>
            {issue.captureIssues && issue.captureIssues.length > 0 ? (
              <div className="mt-2 space-y-1 rounded-lg bg-[var(--color-surface-muted)]/60 px-3 py-2">
                {issue.captureIssues.map((captureIssue) => (
                  <div key={`${captureIssue.path}:${captureIssue.reason}`} className="flex flex-wrap justify-between gap-2 font-mono text-[0.68rem]">
                    <span className="text-[var(--color-text)]">{captureIssue.path}</span>
                    <span className="text-[var(--color-text-muted)]">{captureReason(captureIssue.reason, t)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function SpanNode({
  span,
  trace,
  contentBySequence,
  highlightedSequence,
  onReadContent,
}: {
  readonly span: ObservabilitySpanUiDto;
  readonly trace: ObservabilityTraceDetailUiDto;
  readonly contentBySequence: Readonly<Record<number, ObservabilityGetContentResult | 'loading'>>;
  readonly highlightedSequence?: number;
  readonly onReadContent: (sequence: number) => void;
}) {
  const { t } = useTranslation('settings');
  const children = trace.spans.filter((candidate) => candidate.parentSpanId === span.spanId);
  const contents = trace.contents.filter((content) => content.spanId === span.spanId);
  const events = span.events.filter((event) => !(
    event.type === 'tool.permission.resolved'
    && children.some((child) => child.name === 'permission.await')
  ));
  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 shadow-[0_1px_0_rgba(0,0,0,0.025)]">
      <div className="flex items-start gap-3">
        <SpanStatusIcon outcome={span.outcome?.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-[var(--color-text)]">{spanDisplayName(span, t)}</div>
              <div className="mt-0.5 font-mono text-[0.66rem] text-[var(--color-text-muted)]">{span.name}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-[0.7rem] text-[var(--color-text-muted)]">
              {span.name === 'tool.call' ? (
                <>
                  <span className="font-medium">{t(`diagnostics.status.${spanStatus(span)}`)}</span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <span className="font-mono">{formatTraceDuration(span.durationMs)}</span>
            </div>
          </div>

          {events.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {events.map((event) => (
                <span key={event.sequence} className="rounded-md bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-[0.64rem] text-[var(--color-text-muted)]">
                  {eventDisplayName(event, t)}
                </span>
              ))}
            </div>
          ) : null}

          {contents.length > 0 ? (
            <div className="mt-3 space-y-2.5">
              {contents.map((content) => (
                <ContentCheckpoint
                  key={content.sequence}
                  checkpoint={content}
                  result={contentBySequence[content.sequence]}
                  highlighted={highlightedSequence === content.sequence}
                  onReadContent={onReadContent}
                />
              ))}
            </div>
          ) : null}

          {children.length > 0 ? (
            <div className="mt-3 space-y-3 border-l-2 border-[var(--color-accent)]/15 pl-3">
              {children.map((child) => (
                <SpanNode
                  key={child.spanId}
                  span={child}
                  trace={trace}
                  contentBySequence={contentBySequence}
                  highlightedSequence={highlightedSequence}
                  onReadContent={onReadContent}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ContentCheckpoint({
  checkpoint,
  result,
  highlighted,
  onReadContent,
}: {
  readonly checkpoint: ObservabilityContentCheckpointUiDto;
  readonly result?: ObservabilityGetContentResult | 'loading';
  readonly highlighted: boolean;
  readonly onReadContent: (sequence: number) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <TraceContentViewer
      checkpoint={checkpoint}
      displayName={contentName(checkpoint.kind, t)}
      result={result}
      highlighted={highlighted}
      onRead={() => onReadContent(checkpoint.sequence)}
      labels={{
        view: t('diagnostics.viewContent'),
        collapse: t('diagnostics.collapseContent'),
        loading: t('diagnostics.loadingContent'),
        binary: t('diagnostics.binaryContent'),
        unavailable: t('diagnostics.contentUnavailable'),
        checksum: t('diagnostics.checksum'),
        byteUnit: t('diagnostics.byteUnit'),
        formatted: t('diagnostics.formattedContent'),
        original: t('diagnostics.originalContent'),
        copy: t('diagnostics.copyContent'),
        copied: t('diagnostics.copiedContent'),
        technicalDetails: t('diagnostics.contentTechnicalDetails'),
        recordSequence: t('diagnostics.recordSequence', { sequence: checkpoint.sequence }),
      }}
    />
  );
}

function TimingAnalysis({ trace }: { readonly trace: ObservabilityTraceDetailUiDto }) {
  const { t } = useTranslation('settings');
  const spans = [...trace.spans].sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0));
  const maximum = Math.max(1, ...spans.map((span) => span.durationMs ?? 0));
  return (
    <section aria-label={t('diagnostics.timingAnalysis')}>
      <SectionTitle icon={<TimerReset size={15} />} title={t('diagnostics.timingAnalysis')} />
      <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {spans.map((span) => (
          <div key={span.spanId} className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(8rem,1.2fr)_4.5rem] items-center gap-3 border-b border-[var(--color-border)] px-3.5 py-3 last:border-b-0">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-[var(--color-text)]">{spanName(span.name, t)}</div>
              <div className="mt-0.5 truncate font-mono text-[0.64rem] text-[var(--color-text-muted)]">{span.name}</div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
              <div
                className="h-full rounded-full bg-[var(--color-accent)]/75"
                style={{ width: `${Math.max(1, ((span.durationMs ?? 0) / maximum) * 100)}%` }}
              />
            </div>
            <div className="text-right font-mono text-[0.68rem] text-[var(--color-text-muted)]">
              {formatTraceDuration(span.durationMs)}
            </div>
          </div>
        ))}
        {spans.length === 0 ? <EmptyLine label={t('diagnostics.noSpans')} /> : null}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { readonly status: ObservabilityTraceDetailUiDto['summary']['status'] }) {
  const { t } = useTranslation('settings');
  const classes = status === 'ok'
    ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
    : status === 'error'
      ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
      : status === 'cancelled'
        ? 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]'
        : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]';
  return (
    <span className={cx('rounded-full px-2.5 py-1 text-xs font-medium', classes)}>
      {t(`diagnostics.executionStatus.${status}`)}
    </span>
  );
}

function SpanStatusIcon({ outcome }: { readonly outcome?: 'ok' | 'error' | 'cancelled' | 'unavailable' }) {
  if (outcome === 'ok') return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--color-success)]" />;
  if (outcome === 'error') return <XCircle size={16} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />;
  if (outcome === 'cancelled') return <CircleSlash size={16} className="mt-0.5 shrink-0 text-[var(--color-text-muted)]" />;
  return <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />;
}

function SectionTitle({ icon, title }: { readonly icon: ReactNode; readonly title: string }) {
  return (
    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
      {icon}{title}
    </h4>
  );
}

function EmptyLine({ label }: { readonly label: string }) {
  return <div className="px-3 py-8 text-center text-xs text-[var(--color-text-muted)]">{label}</div>;
}

function issueTitle(
  issue: ObservabilityTraceDetailUiDto['issues'][number],
  t: TFunction<'settings'>,
): string {
  switch (issue.code) {
    case 'partial_content_capture': return contentName(issue.contentKind ?? '', t);
    case 'missing_trace_start': return t('diagnostics.issueCodes.missingTraceStart');
    case 'missing_trace_end': return t('diagnostics.issueCodes.missingTraceEnd');
    case 'missing_span_start': return t('diagnostics.issueCodes.missingSpanStart');
    case 'missing_span_end': return t('diagnostics.issueCodes.missingSpanEnd');
    case 'sequence_gap': return t('diagnostics.issueCodes.sequenceGap');
    case 'missing_content': return t('diagnostics.issueCodes.missingContent');
    case 'content_hash_mismatch': return t('diagnostics.issueCodes.contentHashMismatch');
    case 'content_length_mismatch': return t('diagnostics.issueCodes.contentLengthMismatch');
    case 'content_read_failed': return t('diagnostics.issueCodes.contentReadFailed');
    case 'unavailable_content': return t('diagnostics.issueCodes.unavailableContent');
    case 'unavailable_outcome': return t('diagnostics.issueCodes.unavailableOutcome');
    case 'diagnostics_dropped': return t('diagnostics.issueCodes.diagnosticsDropped');
    default: return issue.code;
  }
}

function captureReason(reason: string, t: TFunction<'settings'>): string {
  return reason === 'unsupported_value' ? t('diagnostics.unsupportedValue') : reason;
}

function traceKindName(kind: string, t: TFunction<'settings'>): string {
  if (kind === 'conversation') return t('diagnostics.traceKinds.conversation');
  if (kind === 'daily_recommendation') return t('diagnostics.traceKinds.dailyRecommendation');
  return t('diagnostics.unknownTraceKind');
}

function spanName(name: string, t: TFunction<'settings'>): string {
  switch (name) {
    case 'model.resolve': return t('diagnostics.spanNames.modelResolve');
    case 'input.process': return t('diagnostics.spanNames.inputProcess');
    case 'session.resolve': return t('diagnostics.spanNames.sessionResolve');
    case 'session.create': return t('diagnostics.spanNames.sessionCreate');
    case 'session.branch.resolve': return t('diagnostics.spanNames.sessionBranchResolve');
    case 'session.branch.commit': return t('diagnostics.spanNames.sessionBranchCommit');
    case 'session.message.commit': return t('diagnostics.spanNames.sessionMessageCommit');
    case 'recommendation.reference.resolve': return t('diagnostics.spanNames.recommendationReferenceResolve');
    case 'agent.execution': return t('diagnostics.spanNames.agentExecution');
    case 'context.build': return t('diagnostics.spanNames.contextBuild');
    case 'context.resolve': return t('diagnostics.spanNames.contextResolve');
    case 'context.compact': return t('diagnostics.spanNames.contextCompact');
    case 'prompt.build': return t('diagnostics.spanNames.promptBuild');
    case 'model.call': return t('diagnostics.spanNames.modelCall');
    case 'tool.call': return t('diagnostics.spanNames.toolCall');
    case 'permission.await': return t('diagnostics.spanNames.permissionAwait');
    case 'discovery.preflight': return t('diagnostics.spanNames.discoveryPreflight');
    case 'source.availability.check': return t('diagnostics.spanNames.sourceAvailabilityCheck');
    case 'discovery.batch.claim': return t('diagnostics.spanNames.discoveryBatchClaim');
    case 'discovery.attempt': return t('diagnostics.spanNames.discoveryAttempt');
    case 'source.search': return t('diagnostics.spanNames.sourceSearch');
    case 'source.read': return t('diagnostics.spanNames.sourceRead');
    case 'discovery.selection': return t('diagnostics.spanNames.discoverySelection');
    case 'discovery.attempt.settle': return t('diagnostics.spanNames.discoveryAttemptSettle');
    case 'recommendation.publish': return t('diagnostics.spanNames.recommendationPublish');
    default: return name;
  }
}

function spanDisplayName(
  span: ObservabilitySpanUiDto,
  t: TFunction<'settings'>,
): string {
  if (span.name === 'tool.call' && span.metadata?.kind === 'tool_call') {
    return t('diagnostics.toolCallLabel', { toolName: span.metadata.toolName });
  }
  if (span.name !== 'permission.await') return spanName(span.name, t);
  const decision = permissionOutcomeName(span, t);
  return decision
    ? t('diagnostics.permissionResolution', { decision })
    : spanName(span.name, t);
}

function spanStatus(span: ObservabilitySpanUiDto): 'ok' | 'error' | 'cancelled' | 'incomplete' {
  if (!span.outcome || span.outcome.status === 'unavailable') return 'incomplete';
  return span.outcome.status;
}

function eventDisplayName(
  event: ObservabilitySpanUiDto['events'][number],
  t: TFunction<'settings'>,
): string {
  if (event.type !== 'tool.permission.resolved') return event.type;
  const decision = permissionDecisionName(event.detail.decision, t);
  return decision ? t('diagnostics.permissionEvent', { decision }) : event.type;
}

function permissionOutcomeName(
  span: ObservabilitySpanUiDto,
  t: TFunction<'settings'>,
): string | undefined {
  const outcome = span.outcome;
  if (!outcome || outcome.status === 'unavailable') return undefined;
  if (outcome.status === 'cancelled' || outcome.code === 'approval_cancelled') {
    return t('diagnostics.permissionDecisions.cancelled');
  }
  if (outcome.code === 'approved') return t('diagnostics.permissionDecisions.userAllow');
  if (outcome.code === 'denied') return t('diagnostics.permissionDecisions.userDeny');
  return undefined;
}

function permissionDecisionName(
  decision: string | number | boolean | null | undefined,
  t: TFunction<'settings'>,
): string | undefined {
  if (decision === 'automatic_allow') return t('diagnostics.permissionDecisions.automaticAllow');
  if (decision === 'automatic_deny') return t('diagnostics.permissionDecisions.automaticDeny');
  if (decision === 'user_allow') return t('diagnostics.permissionDecisions.userAllow');
  if (decision === 'user_deny') return t('diagnostics.permissionDecisions.userDeny');
  return undefined;
}

function contentName(kind: string, t: TFunction<'settings'>): string {
  switch (kind) {
    case 'input.received': return t('diagnostics.contentNames.inputReceived');
    case 'input.processed': return t('diagnostics.contentNames.inputProcessed');
    case 'session.message.committed': return t('diagnostics.contentNames.sessionMessageCommitted');
    case 'context.resolved': return t('diagnostics.contentNames.contextResolved');
    case 'context.compaction.source': return t('diagnostics.contentNames.contextCompactionSource');
    case 'context.compaction.summary': return t('diagnostics.contentNames.contextCompactionSummary');
    case 'prompt.final': return t('diagnostics.contentNames.promptFinal');
    case 'model.request': return t('diagnostics.contentNames.modelRequest');
    case 'model.provider_request': return t('diagnostics.contentNames.modelProviderRequest');
    case 'model.provider_response': return t('diagnostics.contentNames.modelProviderResponse');
    case 'model.response': return t('diagnostics.contentNames.modelResponse');
    case 'tool.request': return t('diagnostics.contentNames.toolRequest');
    case 'tool.arguments': return t('diagnostics.contentNames.toolArguments');
    case 'tool.handler_result': return t('diagnostics.contentNames.toolHandlerResult');
    case 'tool.result': return t('diagnostics.contentNames.toolResult');
    case 'source.request': return t('diagnostics.contentNames.sourceRequest');
    case 'source.provider_response': return t('diagnostics.contentNames.sourceProviderResponse');
    case 'source.result': return t('diagnostics.contentNames.sourceResult');
    case 'discovery.material': return t('diagnostics.contentNames.discoveryMaterial');
    case 'discovery.candidates': return t('diagnostics.contentNames.discoveryCandidates');
    case 'discovery.selection': return t('diagnostics.contentNames.discoverySelection');
    case 'discovery.recommendations': return t('diagnostics.contentNames.discoveryRecommendations');
    case 'recommendation.published': return t('diagnostics.contentNames.recommendationPublished');
    default: return kind;
  }
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}
