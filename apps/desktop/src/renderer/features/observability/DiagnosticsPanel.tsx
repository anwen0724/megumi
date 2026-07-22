/* Joins local Run traces with canonical Project, Session, and user-message facts for diagnostics. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  CircleSlash,
  Clock3,
  Download,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { RunTraceDetail, RunTraceSummary } from "@megumi/observability";
import type {
  ChatSessionUiDto,
  WorkspaceProjectUiDto,
} from "@megumi/product/host-interface";
import { IPC_CHANNELS } from "../../../main/ipc/channels";
import { createRendererRuntimeIpcRequest } from "../../shared/ipc/runtime-request";
import { Button, SettingsPageHeader, cx } from "../../shared/ui";
import { formatDate, formatNumber, formatPercent, rendererI18n } from "../../shared/i18n";

const ALL_FILTER = "__all__";
const NO_PROJECT_FILTER = "__no_project__";
const NO_SESSION_FILTER = "__no_session__";

export function DiagnosticsPanel() {
  const { t } = useTranslation('settings');
  const [traces, setTraces] = useState<RunTraceSummary[]>([]);
  const [projects, setProjects] = useState<WorkspaceProjectUiDto[]>([]);
  const [sessions, setSessions] = useState<ChatSessionUiDto[]>([]);
  const [runInputById, setRunInputById] = useState<Record<string, string>>({});
  const [projectFilter, setProjectFilter] = useState(ALL_FILTER);
  const [sessionFilter, setSessionFilter] = useState(ALL_FILTER);
  const [selected, setSelected] = useState<RunTraceDetail>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<'unavailable' | 'exported' | 'exportFailed'>();

  const load = async () => {
    setLoading(true);
    setMessage(undefined);
    const [traceResult, projectResult, sessionResult] = await Promise.all([
      window.megumi.observability.list(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.list, {
          limit: 50,
        }),
      ),
      window.megumi.project.list(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.projectList, {}),
      ),
      window.megumi.session.list(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.sessionList, {}),
      ),
    ]);

    if (!traceResult.ok || traceResult.data.status !== "ok") {
      setMessage('unavailable');
      setLoading(false);
      return;
    }

    const nextTraces = traceResult.data.traces;
    setTraces(nextTraces);
    setProjects(projectResult.ok ? projectResult.data.projects : []);
    setSessions(
      sessionResult.ok && sessionResult.data.status === "ok"
        ? sessionResult.data.sessions
        : [],
    );
    setRunInputById(await loadRunInputLabels(nextTraces));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.projectId, project.name])),
    [projects],
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const projectIds = useMemo(
    () => unique(traces.map(projectFilterValue)),
    [traces],
  );
  const sessionIds = useMemo(
    () => unique(
      traces
        .filter((trace) => projectFilter === ALL_FILTER || projectFilterValue(trace) === projectFilter)
        .map(sessionFilterValue),
    ),
    [projectFilter, traces],
  );
  const filteredTraces = useMemo(
    () => traces.filter((trace) => (
      (projectFilter === ALL_FILTER || projectFilterValue(trace) === projectFilter)
      && (sessionFilter === ALL_FILTER || sessionFilterValue(trace) === sessionFilter)
    )),
    [projectFilter, sessionFilter, traces],
  );

  const inspect = async (runId: string) => {
    const result = await window.megumi.observability.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.get, {
        runId,
      }),
    );
    if (result.ok && result.data.status === "found")
      setSelected(result.data.trace);
  };
  const exportBundle = async () => {
    if (!selected) return;
    const result = await window.megumi.observability.createBundle(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.bundle, {
        runId: selected.summary.runId,
      }),
    );
    if (result.ok)
      setMessage(
        result.data.status === "saved"
          ? 'exported'
          : result.data.status === "cancelled"
            ? undefined
            : 'exportFailed',
      );
  };
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('diagnostics.title')}
        description={t('diagnostics.description')}
        action={(
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" />
            {t('diagnostics.refresh')}
          </Button>
        )}
      />
      {loading ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-12 text-center text-sm text-[var(--color-text-muted)]">
          {t('diagnostics.loading')}
        </div>
      ) : message ? (
        <p role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          {t(`diagnostics.${message}`)}
        </p>
      ) : (
        <div className="grid min-h-[28rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
          <section className="border-b border-[var(--color-border)] p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('diagnostics.recentRuns')}</h2>
              <span className="text-xs text-[var(--color-text-subtle)]">
                {filteredTraces.length === traces.length
                  ? traces.length
                  : t('diagnostics.filteredCount', { filtered: filteredTraces.length, total: traces.length })}
              </span>
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <DiagnosticFilter
                label={t('diagnostics.project')}
                value={projectFilter}
                onChange={(value) => {
                  setProjectFilter(value);
                  setSessionFilter(ALL_FILTER);
                  setSelected(undefined);
                }}
              >
                <option value={ALL_FILTER}>{t('diagnostics.allProjects')}</option>
                {projectIds.map((projectId) => (
                  <option key={projectId} value={projectId}>
                    {projectId === NO_PROJECT_FILTER
                      ? t('diagnostics.noProject')
                      : projectNameById.get(projectId) ?? t('diagnostics.unavailableProject')}
                  </option>
                ))}
              </DiagnosticFilter>
              <DiagnosticFilter
                label={t('diagnostics.session')}
                value={sessionFilter}
                onChange={(value) => {
                  setSessionFilter(value);
                  setSelected(undefined);
                }}
              >
                <option value={ALL_FILTER}>{t('diagnostics.allSessions')}</option>
                {sessionIds.map((sessionId) => {
                  const session = sessionById.get(sessionId);
                  const projectName = session
                    ? projectNameById.get(session.projectId)
                    : undefined;
                  return (
                    <option key={sessionId} value={sessionId}>
                      {sessionId === NO_SESSION_FILTER
                        ? t('diagnostics.noSession')
                        : projectFilter === ALL_FILTER && projectName
                          ? `${projectName} / ${session?.title ?? t('diagnostics.unavailableSession')}`
                          : session?.title ?? t('diagnostics.unavailableSession')}
                    </option>
                  );
                })}
              </DiagnosticFilter>
            </div>
            {traces.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                {t('diagnostics.empty')}
              </p>
            ) : filteredTraces.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                {t('diagnostics.noMatches')}
              </p>
            ) : (
              <div className="space-y-1.5">
                {filteredTraces.map((trace) => (
                <button
                  key={trace.runId}
                  onClick={() => void inspect(trace.runId)}
                  aria-label={runInputById[trace.runId] ?? formatRunFallback(trace)}
                  className={cx(
                    "relative w-full cursor-pointer rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                    selected?.summary.runId === trace.runId
                      ? "border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]"
                      : "border-transparent hover:bg-[var(--color-surface-muted)]",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-[var(--color-text)]">
                      {runInputById[trace.runId] ?? formatRunFallback(trace)}
                    </span>
                    <RunStatusIcon status={trace.status} />
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {formatRunTime(trace.startedAt)}
                  </div>
                </button>
                ))}
              </div>
            )}
          </section>
          <section className="min-w-0 p-5">
            {!selected ? (
              <div className="grid min-h-[24rem] place-items-center text-center">
                <div>
                  <h2 className="text-sm font-medium text-[var(--color-text)]">{t('diagnostics.selectRun')}</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {t('diagnostics.selectHint')}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <h2 className="truncate text-base font-semibold text-[var(--color-text)]">
                        {runInputById[selected.summary.runId] ?? formatRunFallback(selected.summary)}
                      </h2>
                      <RunStatusIcon status={selected.summary.status} />
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {formatRunSource(selected.summary, projectNameById, sessionById)}
                    </p>
                    <p className="mt-1 font-mono text-xs text-[var(--color-text-subtle)]">
                      {selected.summary.runId}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void exportBundle()}
                  >
                    <Download size={14} aria-hidden="true" />
                    {t('diagnostics.export')}
                  </Button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <DiagnosticMetric
                    label={t('diagnostics.duration')}
                    value={formatDuration(selected.summary.durationMs)}
                    detail={t('diagnostics.totalRunTime')}
                  />
                  <DiagnosticMetric
                    label={t('diagnostics.modelCalls')}
                    value={formatNumber(selected.summary.modelCallCount)}
                    detail={t('diagnostics.providerRequests')}
                  />
                  <DiagnosticMetric
                    label={t('diagnostics.toolCalls')}
                    value={formatNumber(selected.summary.toolCallCount)}
                    detail={t('diagnostics.toolExecutions')}
                  />
                  <DiagnosticMetric
                    label={t('diagnostics.contextCapacity')}
                    value={formatContextCapacity(selected.summary)}
                    detail={formatContextRatio(
                      selected.summary.contextUsedRatio,
                    )}
                  />
                  <DiagnosticMetric
                    label={t('diagnostics.providerUsage')}
                    value={formatProviderUsage(selected.summary)}
                    detail={t('diagnostics.modelCallCount', { count: selected.summary.modelCallCount })}
                  />
                </div>
                <h3 className="mt-5 text-sm font-semibold text-[var(--color-text)]">
                  {t('diagnostics.executionTimeline')}
                </h3>
                <ol className="mt-2 space-y-1">
                  {selected.spans.map((span) => (
                    <li
                      key={span.spanId}
                      className="flex min-h-10 items-center justify-between gap-4 border-l-2 border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
                    >
                      <span className="text-[var(--color-text)]">{formatSpanName(span.name)}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
                        {span.durationMs === undefined
                          ? t('diagnostics.durationUnavailable')
                          : `${Math.round(span.durationMs)} ms`}{" "}
                        · {formatStatus(span.status)}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function DiagnosticFilter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.68rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
        {label}
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full cursor-pointer rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-focus)]"
      >
        {children}
      </select>
    </label>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  const label = formatStatus(status);
  const iconClassName = cx("h-4 w-4", statusClassName(status));
  const icon = status === "ok"
    ? <CheckCircle2 className={iconClassName} aria-hidden="true" />
    : status === "error"
      ? <XCircle className={iconClassName} aria-hidden="true" />
      : status === "cancelled"
        ? <CircleSlash className={iconClassName} aria-hidden="true" />
        : <Clock3 className={iconClassName} aria-hidden="true" />;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center self-center">
      {icon}
    </span>
  );
}

function DiagnosticMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5">
      <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)]">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
        {detail}
      </div>
    </div>
  );
}

function formatContextCapacity(summary: RunTraceSummary): string {
  if (
    summary.contextUsedTokens === undefined
    || summary.contextWindowTokens === undefined
  ) {
    return rendererI18n.t('settings:diagnostics.unavailableValue');
  }
  return `${formatTokens(summary.contextUsedTokens)} / ${formatTokens(summary.contextWindowTokens)}`;
}

function formatContextRatio(ratio: number | undefined): string {
  return ratio === undefined
    ? rendererI18n.t('settings:diagnostics.contextNotRecorded')
    : rendererI18n.t('settings:diagnostics.contextRatio', { percent: formatPercent(ratio) });
}

function formatProviderUsage(summary: RunTraceSummary): string {
  const input = summary.providerInputTokens;
  const output = summary.providerOutputTokens;
  if (input === undefined && output === undefined) return rendererI18n.t('settings:diagnostics.notReported');
  const inputLabel = input === undefined ? "—" : formatTokens(input);
  const outputLabel = output === undefined ? "—" : formatTokens(output);
  return rendererI18n.t('settings:diagnostics.providerUsageValue', { input: inputLabel, output: outputLabel });
}

function formatTokens(value: number): string {
  return formatNumber(value);
}

async function loadRunInputLabels(
  traces: readonly RunTraceSummary[],
): Promise<Record<string, string>> {
  const runIds = unique(traces.map((trace) => trace.runId));
  if (runIds.length === 0) return {};
  let result;
  try {
    result = await window.megumi.session.message.list(
      createRendererRuntimeIpcRequest(
        IPC_CHANNELS.chat.sessionMessageList,
        { runIds },
      ),
    );
  } catch {
    return {};
  }
  const labels: Record<string, string> = {};
  if (!result.ok || result.data.status !== "ok") return labels;
  for (const item of result.data.messages) {
    if (item.role !== "user" || !item.runId || labels[item.runId]) continue;
    const summary = summarizeUserInput(item.text);
    if (summary) labels[item.runId] = summary;
  }
  return labels;
}

function summarizeUserInput(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 79)}…` : normalized;
}

function formatRunFallback(_trace: RunTraceSummary): string {
  return rendererI18n.t('settings:diagnostics.userMessageUnavailable');
}

function formatRunSource(
  trace: RunTraceSummary,
  projectNameById: ReadonlyMap<string, string>,
  sessionById: ReadonlyMap<string, ChatSessionUiDto>,
): string {
  const projectName = trace.workspaceId
    ? projectNameById.get(trace.workspaceId) ?? rendererI18n.t('settings:diagnostics.unavailableProject')
    : rendererI18n.t('settings:diagnostics.noProject');
  const sessionTitle = trace.sessionId
    ? sessionById.get(trace.sessionId)?.title ?? rendererI18n.t('settings:diagnostics.unavailableSession')
    : rendererI18n.t('settings:diagnostics.noSession');
  return `${projectName} / ${sessionTitle} · ${formatRunTime(trace.startedAt)}`;
}

function formatRunTime(value: string): string {
  return formatDate(value, undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) ?? rendererI18n.t('settings:diagnostics.unavailableValue');
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return rendererI18n.t('settings:diagnostics.unavailableValue');
  return value >= 1_000
    ? `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`
    : `${Math.round(value)} ms`;
}

function projectFilterValue(trace: RunTraceSummary): string {
  return trace.workspaceId ?? NO_PROJECT_FILTER;
}

function sessionFilterValue(trace: RunTraceSummary): string {
  return trace.sessionId ?? NO_SESSION_FILTER;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function formatSpanName(name: string): string {
  const names: Record<string, string> = {
    agent_run: rendererI18n.t('settings:diagnostics.spans.agentRun'),
    "context.prepare_model_call": rendererI18n.t('settings:diagnostics.spans.prepareContext'),
    "context.compact": rendererI18n.t('settings:diagnostics.spans.compact'),
    "model.call": rendererI18n.t('settings:diagnostics.spans.modelCall'),
    "tool.call": rendererI18n.t('settings:diagnostics.spans.toolCall'),
    "approval.wait": rendererI18n.t('settings:diagnostics.spans.approval'),
    "session.append_message": rendererI18n.t('settings:diagnostics.spans.saveMessage'),
  };
  return names[name] ?? name;
}

function formatStatus(status: string): string {
  if (status === "ok") return rendererI18n.t('settings:diagnostics.status.ok');
  if (status === "error") return rendererI18n.t('settings:diagnostics.status.error');
  if (status === "cancelled") return rendererI18n.t('settings:diagnostics.status.cancelled');
  return rendererI18n.t('settings:diagnostics.status.incomplete');
}

function statusClassName(status: string): string {
  if (status === "ok") return "text-[var(--color-success)]";
  if (status === "error") return "text-[var(--color-danger)]";
  return "text-[var(--color-text-muted)]";
}
