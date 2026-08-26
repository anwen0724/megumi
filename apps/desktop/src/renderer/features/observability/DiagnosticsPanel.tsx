/*
 * Owns the Desktop Trace diagnostics query state and explicit diagnostic actions.
 * It reads only Product Host observability contracts and never joins business state.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Download, RefreshCw, RotateCcw } from 'lucide-react';
import type {
  ObservabilityGetContentResult,
  ObservabilityHealthUiDto,
  ObservabilityLegacyListResult,
  ObservabilityTraceDetailUiDto,
  ObservabilityTraceSummaryUiDto,
} from '@megumi/product-host/host';
import { IPC_CHANNELS } from '../../../main/ipc/channels';
import type { ObservabilityListPayload } from '../../../main/ipc/schemas';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc/runtime-request';
import { Button, SettingsPageHeader } from '../../shared/ui';
import { correlationFromFilter } from './diagnostics-format';
import { TraceDetail } from './TraceDetail';
import { TraceList } from './TraceList';

type LegacyDiagnosticUiDto = Extract<
  ObservabilityLegacyListResult,
  { readonly status: 'ok' }
>['diagnostics'][number];

export function DiagnosticsPanel() {
  const { t } = useTranslation('settings');
  const [traces, setTraces] = useState<readonly ObservabilityTraceSummaryUiDto[]>([]);
  const [selected, setSelected] = useState<ObservabilityTraceDetailUiDto>();
  const [contentBySequence, setContentBySequence] = useState<Readonly<Record<number, ObservabilityGetContentResult | 'loading'>>>({});
  const [health, setHealth] = useState<ObservabilityHealthUiDto>();
  const [legacy, setLegacy] = useState<readonly LegacyDiagnosticUiDto[]>([]);
  const [traceKind, setTraceKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [correlation, setCorrelation] = useState('');
  const [startedAtOrAfter, setStartedAtOrAfter] = useState('');
  const [startedBefore, setStartedBefore] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<'unavailable' | 'exported' | 'exportFailed' | 'rebuilt'>();

  const load = async () => {
    setLoading(true);
    setMessage(undefined);
    const payload = createListPayload({
      traceKind, status, correlation, startedAtOrAfter, startedBefore,
    });
    const [listResult, healthResult, legacyResult] = await Promise.all([
      window.megumi.observability.list(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.list, payload),
      ),
      window.megumi.observability.getHealth(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.health, {}),
      ),
      window.megumi.observability.listLegacy(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.legacy, { limit: 50 }),
      ),
    ]);
    if (!listResult.ok || listResult.data.status !== 'ok') {
      setMessage('unavailable');
    } else {
      setTraces(listResult.data.traces);
      if (selected && !listResult.data.traces.some((trace) => trace.traceId === selected.summary.traceId)) {
        setSelected(undefined);
        setContentBySequence({});
      }
    }
    if (healthResult.ok && healthResult.data.status === 'ok') setHealth(healthResult.data.health);
    if (legacyResult.ok && legacyResult.data.status === 'ok') setLegacy(legacyResult.data.diagnostics);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // Filters are submitted explicitly through Refresh, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inspect = async (traceId: string) => {
    setContentBySequence({});
    const result = await window.megumi.observability.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.get, { traceId }),
    );
    if (result.ok && result.data.status === 'found') setSelected(result.data.trace);
  };

  const readContent = async (sequence: number) => {
    if (!selected) return;
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
  };

  const rebuildIndex = async () => {
    const result = await window.megumi.observability.rebuildIndex(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.rebuildIndex, {}),
    );
    if (result.ok && result.data.status === 'rebuilt') {
      await load();
      setMessage('rebuilt');
    } else {
      setMessage('unavailable');
    }
  };

  const exportBundle = async () => {
    if (!selected) return;
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
  };

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t('diagnostics.title')}
        description={t('diagnostics.description')}
        action={(
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void rebuildIndex()}>
              <RotateCcw size={14} aria-hidden="true" />{t('diagnostics.rebuildIndex')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              <RefreshCw size={14} aria-hidden="true" />{t('diagnostics.refresh')}
            </Button>
          </div>
        )}
      />

      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <FilterSelect label={t('diagnostics.traceKind')} value={traceKind} onChange={setTraceKind}>
            <option value="all">{t('diagnostics.allKinds')}</option>
            <option value="conversation">{t('diagnostics.traceKinds.conversation')}</option>
            <option value="daily_discovery">{t('diagnostics.traceKinds.dailyDiscovery')}</option>
          </FilterSelect>
          <FilterSelect label={t('diagnostics.statusLabel')} value={status} onChange={setStatus}>
            <option value="all">{t('diagnostics.allStatuses')}</option>
            <option value="ok">{t('diagnostics.status.ok')}</option>
            <option value="error">{t('diagnostics.status.error')}</option>
            <option value="cancelled">{t('diagnostics.status.cancelled')}</option>
            <option value="incomplete">{t('diagnostics.status.incomplete')}</option>
          </FilterSelect>
          <FilterInput label={t('diagnostics.correlation')} value={correlation} onChange={setCorrelation} placeholder={t('diagnostics.correlationPlaceholder')} />
          <FilterInput label={t('diagnostics.startedAfter')} value={startedAtOrAfter} onChange={setStartedAtOrAfter} type="datetime-local" />
          <FilterInput label={t('diagnostics.startedBefore')} value={startedBefore} onChange={setStartedBefore} type="datetime-local" />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
          <HealthSummary health={health} />
          {message ? <span className="text-xs text-[var(--color-text-muted)]">{t(`diagnostics.${message}`)}</span> : null}
        </div>
      </section>

      <section className="grid min-h-[34rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
        <div className="border-b border-[var(--color-border)] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('diagnostics.recentTraces')}</h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t('diagnostics.traceCount', { count: traces.length })}</p>
            </div>
            {loading ? <RefreshCw size={14} className="animate-spin text-[var(--color-text-muted)]" /> : null}
          </div>
          <div className="max-h-[42rem] overflow-auto">
            <TraceList
              traces={traces}
              selectedTraceId={selected?.summary.traceId}
              emptyLabel={loading ? t('diagnostics.loading') : t('diagnostics.empty')}
              onSelect={(traceId) => void inspect(traceId)}
            />
          </div>
        </div>
        <div className="min-w-0 overflow-auto">
          {selected ? (
            <>
              <div className="flex justify-end border-b border-[var(--color-border)] px-5 py-2.5">
                <Button size="sm" variant="secondary" onClick={() => void exportBundle()}>
                  <Download size={14} aria-hidden="true" />{t('diagnostics.export')}
                </Button>
              </div>
              <TraceDetail
                key={selected.summary.traceId}
                trace={selected}
                contentBySequence={contentBySequence}
                onReadContent={(sequence) => void readContent(sequence)}
              />
            </>
          ) : (
            <div className="flex min-h-[34rem] flex-col items-center justify-center px-6 text-center">
              <div className="rounded-full bg-[var(--color-surface-muted)] p-3 text-[var(--color-text-muted)]"><Activity size={20} /></div>
              <h3 className="mt-3 text-sm font-semibold text-[var(--color-text)]">{t('diagnostics.selectTrace')}</h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--color-text-muted)]">{t('diagnostics.selectHint')}</p>
            </div>
          )}
        </div>
      </section>

      <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text)]">
          {t('diagnostics.legacy')} · {legacy.length}
        </summary>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t('diagnostics.legacyDescription')}</p>
        <div className="mt-3 space-y-1.5">
          {legacy.map((item) => (
            <div key={item.traceId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-xs">
              <span>{item.traceId}</span>
              <span>{t('diagnostics.legacyRecordSummary', { status: item.status, count: item.recordCount })}</span>
            </div>
          ))}
          {legacy.length === 0 ? <div className="text-xs text-[var(--color-text-muted)]">{t('diagnostics.noLegacy')}</div> : null}
        </div>
      </details>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, children,
}: {
  readonly label: string; readonly value: string; readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
      {label}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]">
        {children}
      </select>
    </label>
  );
}

function FilterInput({
  label, value, onChange, placeholder, type = 'text',
}: {
  readonly label: string; readonly value: string; readonly onChange: (value: string) => void;
  readonly placeholder?: string; readonly type?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
      {label}
      <input aria-label={label} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 font-mono text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]" />
    </label>
  );
}

function HealthSummary({ health }: { readonly health?: ObservabilityHealthUiDto }) {
  const { t } = useTranslation('settings');
  const failures = health ? health.journalWriteFailures + health.contentWriteFailures
    + health.flushFailures + health.rotationFailures + health.retentionCleanupFailures
    + health.indexProjectionFailures + health.classifierFailures + health.contextFailures
    + health.captureFailures : 0;
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
      <span className={`size-2 rounded-full ${failures > 0 || (health?.droppedRecords ?? 0) > 0 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]'}`} />
      {t('diagnostics.healthSummary', { dropped: health?.droppedRecords ?? 0, failures })}
    </div>
  );
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function createListPayload(input: {
  readonly traceKind: string;
  readonly status: string;
  readonly correlation: string;
  readonly startedAtOrAfter: string;
  readonly startedBefore: string;
}): ObservabilityListPayload {
  const payload: ObservabilityListPayload = { limit: 50 };
  if (input.traceKind === 'conversation' || input.traceKind === 'daily_discovery') {
    payload.traceKind = input.traceKind;
  }
  if (
    input.status === 'ok' || input.status === 'error'
    || input.status === 'cancelled' || input.status === 'incomplete'
  ) {
    payload.status = input.status;
  }
  const after = toIso(input.startedAtOrAfter);
  const before = toIso(input.startedBefore);
  const traceCorrelation = correlationFromFilter(input.correlation);
  if (after) payload.startedAtOrAfter = after;
  if (before) payload.startedBefore = before;
  if (traceCorrelation) payload.correlation = traceCorrelation;
  return payload;
}
