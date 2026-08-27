/*
 * Owns the human-facing Trace diagnostics workbench and enriches Trace facts with optional Session labels.
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ObservabilityGetContentResult,
  ObservabilityHealthUiDto,
  ObservabilityTraceDetailUiDto,
  ObservabilityTraceSummaryUiDto,
  SessionDto,
  UserMessageSummaryDto,
} from '@megumi/product-host/host';
import { IPC_CHANNELS } from '../../../main/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc/runtime-request';
import { Button, Select, SettingsPageHeader, cx } from '../../shared/ui';
import { TraceDetail } from './TraceDetail';
import { TraceList } from './TraceList';
import {
  createTraceDisplayItems,
  filterTraceDisplayItems,
  groupTraceDisplayItems,
  type TraceDisplayItem,
} from './trace-display';

type TraceKindFilter = 'all' | 'conversation' | 'daily_recommendation' | 'candidate_supply'
  | 'preference_learning';
type TraceStatusFilter = 'all' | ObservabilityTraceSummaryUiDto['status'];
type ActiveAction = 'refresh' | 'rebuild' | 'export';

export function DiagnosticsPanel() {
  const { t, i18n } = useTranslation('settings');
  const [traces, setTraces] = useState<readonly ObservabilityTraceSummaryUiDto[]>([]);
  const [sessions, setSessions] = useState<readonly SessionDto[]>([]);
  const [messages, setMessages] = useState<readonly UserMessageSummaryDto[]>([]);
  const [selected, setSelected] = useState<ObservabilityTraceDetailUiDto>();
  const [contentBySequence, setContentBySequence] = useState<Readonly<Record<number, ObservabilityGetContentResult | 'loading'>>>({});
  const [health, setHealth] = useState<ObservabilityHealthUiDto>();
  const [query, setQuery] = useState('');
  const [traceKind, setTraceKind] = useState<TraceKindFilter>('all');
  const [sessionId, setSessionId] = useState('all');
  const [status, setStatus] = useState<TraceStatusFilter>('all');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeAction, setActiveAction] = useState<ActiveAction>();
  const [message, setMessage] = useState<'unavailable' | 'exported' | 'exportFailed' | 'rebuilt'>();

  const displayItems = useMemo(() => createTraceDisplayItems({
    traces,
    sessions,
    messages,
    locale: i18n.resolvedLanguage ?? i18n.language,
    labels: {
      conversationFallback: t('diagnostics.conversationFallback'),
      deletedSession: t('diagnostics.deletedSession'),
      unassignedSession: t('diagnostics.unassignedSession'),
      dailyRecommendation: t('diagnostics.traceKinds.dailyRecommendation'),
      scheduledDiscovery: t('diagnostics.scheduledDiscovery'),
      candidateSupply: t('diagnostics.traceKinds.candidateSupply'),
      candidateSupplyRun: t('diagnostics.candidateSupplyRun'),
      preferenceLearning: t('diagnostics.traceKinds.preferenceLearning'),
      preferenceLearningRun: t('diagnostics.preferenceLearningRun'),
    },
  }), [i18n.language, i18n.resolvedLanguage, messages, sessions, t, traces]);
  const filteredItems = useMemo(() => filterTraceDisplayItems(displayItems, {
    query, traceKind, sessionId, status, issuesOnly,
  }), [displayItems, issuesOnly, query, sessionId, status, traceKind]);
  const groups = useMemo(() => groupTraceDisplayItems(filteredItems), [filteredItems]);
  const selectedDisplay = selected
    ? displayItems.find((item) => item.summary.traceId === selected.summary.traceId)
    : undefined;
  const sessionOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of displayItems) {
      if (item.sessionId) options.set(item.sessionId, item.groupTitle);
    }
    return [
      { value: 'all', label: t('diagnostics.allSessions') },
      ...[...options.entries()].map(([value, label]) => ({ value, label })),
    ];
  }, [displayItems, t]);

  const load = async () => {
    setLoading(true);
    setMessage(undefined);
    const [listResult, healthResult, sessionsResult] = await Promise.all([
      window.megumi.observability.list(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.list, { limit: 200 }),
      ),
      window.megumi.observability.getHealth(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.health, {}),
      ),
      window.megumi.session.list(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionList, {}),
      ),
    ]);

    if (!listResult.ok || listResult.data.status !== 'ok') {
      setMessage('unavailable');
      setLoading(false);
      return;
    }

    const nextTraces = listResult.data.traces;
    setTraces(nextTraces);
    if (healthResult.ok && healthResult.data.status === 'ok') setHealth(healthResult.data.health);
    setSessions(
      sessionsResult.ok && sessionsResult.data.status === 'ok' ? sessionsResult.data.sessions : [],
    );
    const executionIds = unique(nextTraces.flatMap((trace) => (
      trace.correlation.executionId ? [trace.correlation.executionId] : []
    )));
    if (executionIds.length > 0) {
      const messageResult = await window.megumi.session.message.list(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.session.sessionMessageList, { executionIds }),
      );
      setMessages(
        messageResult.ok && messageResult.data.status === 'ok' ? messageResult.data.messages : [],
      );
    } else {
      setMessages([]);
    }
    if (selected && !nextTraces.some((trace) => trace.traceId === selected.summary.traceId)) {
      setSelected(undefined);
      setContentBySequence({});
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // Initial loading is explicit; later refreshes are user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    if (filteredItems.some((item) => item.summary.traceId === selected.summary.traceId)) return;
    setSelected(undefined);
    setContentBySequence({});
  }, [filteredItems, selected]);

  async function inspect(item: TraceDisplayItem) {
    setContentBySequence({});
    const result = await window.megumi.observability.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.get, {
        traceId: item.summary.traceId,
      }),
    );
    if (result.ok && result.data.status === 'found') setSelected(result.data.trace);
  }

  async function readContent(sequence: number) {
    if (!selected) return;
    if (contentBySequence[sequence] && contentBySequence[sequence] !== 'loading') return;
    setContentBySequence((current) => ({ ...current, [sequence]: 'loading' }));
    const result = await window.megumi.observability.getContent(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.content, {
        traceId: selected.summary.traceId,
        sequence,
      }),
    );
    setContentBySequence((current) => ({
      ...current,
      [sequence]: result.ok
        ? result.data
        : { status: 'failed', message: result.data.message },
    }));
  }

  async function refresh() {
    setActiveAction('refresh');
    try {
      await load();
    } finally {
      setActiveAction(undefined);
    }
  }

  async function rebuildIndex() {
    setActiveAction('rebuild');
    try {
      const result = await window.megumi.observability.rebuildIndex(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.rebuildIndex, {}),
      );
      if (result.ok && result.data.status === 'rebuilt') {
        await load();
        setMessage('rebuilt');
      } else {
        setMessage('unavailable');
      }
    } finally {
      setActiveAction(undefined);
    }
  }

  async function exportBundle() {
    if (!selected) return;
    setActiveAction('export');
    try {
      const result = await window.megumi.observability.createBundle(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.bundle, {
          traceId: selected.summary.traceId,
        }),
      );
      setMessage(
        result.ok && result.data.status === 'saved'
          ? 'exported'
          : result.ok && result.data.status === 'cancelled'
            ? undefined
            : 'exportFailed',
      );
    } finally {
      setActiveAction(undefined);
    }
  }

  const emptyLabel = loading
    ? t('diagnostics.loading')
    : traces.length === 0 ? t('diagnostics.empty') : t('diagnostics.noMatches');

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t('diagnostics.title')}
        description={t('diagnostics.description')}
        action={(
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={activeAction !== undefined}
              onClick={() => void rebuildIndex()}
            >
              <RotateCcw size={14} aria-hidden="true" className={cx(activeAction === 'rebuild' && 'animate-spin')} />
              {activeAction === 'rebuild' ? t('diagnostics.rebuilding') : t('diagnostics.rebuildIndex')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={activeAction !== undefined}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} aria-hidden="true" className={cx(activeAction === 'refresh' && 'animate-spin')} />
              {activeAction === 'refresh' ? t('diagnostics.refreshing') : t('diagnostics.refresh')}
            </Button>
          </div>
        )}
      />

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="relative">
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="search"
            aria-label={t('diagnostics.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('diagnostics.searchPlaceholder')}
            className="h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 text-sm text-[var(--color-text)] shadow-[0_1px_0_rgba(0,0,0,0.03)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-focus)]/35"
          />
        </div>
        <div className="mt-3 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
          <Select
            label={t('diagnostics.traceKind')}
            value={traceKind}
            options={[
              { value: 'all', label: t('diagnostics.allKinds') },
              { value: 'conversation', label: t('diagnostics.traceKinds.conversation') },
              { value: 'daily_recommendation', label: t('diagnostics.traceKinds.dailyRecommendation') },
              { value: 'candidate_supply', label: t('diagnostics.traceKinds.candidateSupply') },
              { value: 'preference_learning', label: t('diagnostics.traceKinds.preferenceLearning') },
            ]}
            onValueChange={setTraceKind}
          />
          {traceKind === 'all' || traceKind === 'conversation' ? (
            <Select label={t('diagnostics.session')} value={sessionId} options={sessionOptions} onValueChange={setSessionId} />
          ) : <div />}
          <Select
            label={t('diagnostics.executionResult')}
            value={status}
            options={[
              { value: 'all', label: t('diagnostics.allExecutionResults') },
              { value: 'ok', label: t('diagnostics.status.ok') },
              { value: 'error', label: t('diagnostics.status.error') },
              { value: 'cancelled', label: t('diagnostics.status.cancelled') },
              { value: 'incomplete', label: t('diagnostics.status.incomplete') },
            ]}
            onValueChange={setStatus}
          />
          <IssueOnlyToggle checked={issuesOnly} onChange={setIssuesOnly} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
          <HealthSummary health={health} />
          {message ? <span className="text-xs text-[var(--color-text-muted)]">{t(`diagnostics.${message}`)}</span> : null}
        </div>
      </section>

      <section className="grid min-h-[38rem] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm lg:grid-cols-[minmax(20rem,0.72fr)_minmax(0,1.28fr)]">
        <div className="border-b border-[var(--color-border)] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('diagnostics.recentTraces')}</h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t('diagnostics.traceCount', { count: filteredItems.length })}</p>
            </div>
            {loading ? <RefreshCw size={14} className="animate-spin text-[var(--color-text-muted)]" /> : null}
          </div>
          <div className="max-h-[48rem] overflow-auto">
            <TraceList
              groups={groups}
              selectedTraceId={selected?.summary.traceId}
              emptyLabel={emptyLabel}
              onSelect={(item) => void inspect(item)}
            />
          </div>
        </div>
        <div className="min-w-0 max-h-[48rem] overflow-auto">
          {selected && selectedDisplay ? (
            <TraceDetail
              key={selected.summary.traceId}
              trace={selected}
              display={selectedDisplay}
              contentBySequence={contentBySequence}
              exportLoading={activeAction === 'export'}
              onReadContent={(sequence) => void readContent(sequence)}
              onExport={() => void exportBundle()}
            />
          ) : (
            <div className="flex min-h-[38rem] flex-col items-center justify-center px-6 text-center">
              <div className="rounded-full bg-[var(--color-surface-muted)] p-3 text-[var(--color-text-muted)]"><Activity size={20} /></div>
              <h3 className="mt-3 text-sm font-semibold text-[var(--color-text)]">{t('diagnostics.selectTrace')}</h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--color-text-muted)]">{t('diagnostics.selectHint')}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function IssueOnlyToggle({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={t('diagnostics.issuesOnly')}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-medium shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] active:shadow-none',
        checked
          ? 'border-[var(--color-warning)]/45 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]',
      )}
    >
      <span className={cx(
        'flex size-4 items-center justify-center rounded border text-[0.65rem]',
        checked ? 'border-[var(--color-warning)] bg-[var(--color-warning)] text-white' : 'border-[var(--color-border-strong)]',
      )}>
        {checked ? '✓' : ''}
      </span>
      {t('diagnostics.issuesOnly')}
    </button>
  );
}

function HealthSummary({ health }: { readonly health?: ObservabilityHealthUiDto }) {
  const { t } = useTranslation('settings');
  if (!health) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span className="size-2 rounded-full bg-[var(--color-text-muted)]/45" />
        <span className="font-medium">{t('diagnostics.healthUnavailable')}</span>
      </div>
    );
  }
  const failures = health.journalWriteFailures + health.contentWriteFailures
    + health.flushFailures + health.rotationFailures + health.retentionCleanupFailures
    + health.indexProjectionFailures + health.classifierFailures + health.contextFailures
    + health.captureFailures;
  const healthy = failures === 0 && health.droppedRecords === 0;
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
      <span className={cx('size-2 rounded-full', healthy ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]')} />
      <span className="font-medium text-[var(--color-text)]">
        {healthy ? t('diagnostics.healthHealthy') : t('diagnostics.healthWarning')}
      </span>
      <span>· {t('diagnostics.healthSummary', { dropped: health.droppedRecords, failures })}</span>
    </div>
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
