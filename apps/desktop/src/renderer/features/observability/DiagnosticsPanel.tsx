/* Joins local Run traces with canonical Project, Session, and user-message facts for diagnostics. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
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

const ALL_FILTER = "__all__";
const NO_PROJECT_FILTER = "__no_project__";
const NO_SESSION_FILTER = "__no_session__";

export function DiagnosticsPanel() {
  const [traces, setTraces] = useState<RunTraceSummary[]>([]);
  const [projects, setProjects] = useState<WorkspaceProjectUiDto[]>([]);
  const [sessions, setSessions] = useState<ChatSessionUiDto[]>([]);
  const [runInputById, setRunInputById] = useState<Record<string, string>>({});
  const [projectFilter, setProjectFilter] = useState(ALL_FILTER);
  const [sessionFilter, setSessionFilter] = useState(ALL_FILTER);
  const [selected, setSelected] = useState<RunTraceDetail>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

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
      setMessage("Diagnostics are unavailable.");
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
          ? "Diagnostic bundle exported."
          : result.data.status === "cancelled"
            ? undefined
            : "Diagnostic bundle export failed.",
      );
  };
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Activity & Diagnostics"
        description="Inspect recent activity, token usage, tool calls, and errors stored locally on this device."
        action={(
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </Button>
        )}
      />
      {loading ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-12 text-center text-sm text-[var(--color-text-muted)]">
          Loading recent activity…
        </div>
      ) : message ? (
        <p role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          {message}
        </p>
      ) : (
        <div className="grid min-h-[28rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
          <section className="border-b border-[var(--color-border)] p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Recent runs</h2>
              <span className="text-xs text-[var(--color-text-subtle)]">
                {filteredTraces.length === traces.length
                  ? traces.length
                  : `${filteredTraces.length} of ${traces.length}`}
              </span>
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <DiagnosticFilter
                label="Project"
                value={projectFilter}
                onChange={(value) => {
                  setProjectFilter(value);
                  setSessionFilter(ALL_FILTER);
                  setSelected(undefined);
                }}
              >
                <option value={ALL_FILTER}>All projects</option>
                {projectIds.map((projectId) => (
                  <option key={projectId} value={projectId}>
                    {projectId === NO_PROJECT_FILTER
                      ? "No project"
                      : projectNameById.get(projectId) ?? "Unavailable project"}
                  </option>
                ))}
              </DiagnosticFilter>
              <DiagnosticFilter
                label="Session"
                value={sessionFilter}
                onChange={(value) => {
                  setSessionFilter(value);
                  setSelected(undefined);
                }}
              >
                <option value={ALL_FILTER}>All sessions</option>
                {sessionIds.map((sessionId) => {
                  const session = sessionById.get(sessionId);
                  const projectName = session
                    ? projectNameById.get(session.projectId)
                    : undefined;
                  return (
                    <option key={sessionId} value={sessionId}>
                      {sessionId === NO_SESSION_FILTER
                        ? "No session"
                        : projectFilter === ALL_FILTER && projectName
                          ? `${projectName} / ${session?.title ?? "Unavailable session"}`
                          : session?.title ?? "Unavailable session"}
                    </option>
                  );
                })}
              </DiagnosticFilter>
            </div>
            {traces.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                No activity recorded yet.
              </p>
            ) : filteredTraces.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                No runs match these filters.
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
                  <h2 className="text-sm font-medium text-[var(--color-text)]">Select a run</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Choose recent activity to inspect its timing and usage.
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
                    Export diagnostics
                  </Button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <DiagnosticMetric
                    label="Duration"
                    value={formatDuration(selected.summary.durationMs)}
                    detail="Total Run time"
                  />
                  <DiagnosticMetric
                    label="Model calls"
                    value={String(selected.summary.modelCallCount)}
                    detail="Provider requests"
                  />
                  <DiagnosticMetric
                    label="Tool calls"
                    value={String(selected.summary.toolCallCount)}
                    detail="Tool executions"
                  />
                  <DiagnosticMetric
                    label="Context capacity"
                    value={formatContextCapacity(selected.summary)}
                    detail={formatContextRatio(
                      selected.summary.contextUsedRatio,
                    )}
                  />
                  <DiagnosticMetric
                    label="Provider usage"
                    value={formatProviderUsage(selected.summary)}
                    detail={`${selected.summary.modelCallCount} model ${selected.summary.modelCallCount === 1 ? "call" : "calls"}`}
                  />
                </div>
                <h3 className="mt-5 text-sm font-semibold text-[var(--color-text)]">
                  Execution timeline
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
                          ? "Duration unavailable"
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
    return "Unavailable";
  }
  return `${formatTokens(summary.contextUsedTokens)} / ${formatTokens(summary.contextWindowTokens)}`;
}

function formatContextRatio(ratio: number | undefined): string {
  return ratio === undefined
    ? "Prompt capacity was not recorded"
    : `${(ratio * 100).toFixed(2)}% of the context window`;
}

function formatProviderUsage(summary: RunTraceSummary): string {
  const input = summary.providerInputTokens;
  const output = summary.providerOutputTokens;
  if (input === undefined && output === undefined) return "Not reported";
  const inputLabel = input === undefined ? "—" : formatTokens(input);
  const outputLabel = output === undefined ? "—" : formatTokens(output);
  return `${inputLabel} in · ${outputLabel} out`;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
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
  return "User message unavailable";
}

function formatRunSource(
  trace: RunTraceSummary,
  projectNameById: ReadonlyMap<string, string>,
  sessionById: ReadonlyMap<string, ChatSessionUiDto>,
): string {
  const projectName = trace.workspaceId
    ? projectNameById.get(trace.workspaceId) ?? "Unavailable project"
    : "No project";
  const sessionTitle = trace.sessionId
    ? sessionById.get(trace.sessionId)?.title ?? "Unavailable session"
    : "No session";
  return `${projectName} / ${sessionTitle} · ${formatRunTime(trace.startedAt)}`;
}

function formatRunTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return "Unavailable";
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
    agent_run: "Overall run",
    "context.prepare_model_call": "Build context",
    "context.compact": "Compress context",
    "model.call": "Generate response",
    "tool.call": "Run tool",
    "approval.wait": "Wait for approval",
    "session.append_message": "Save message",
  };
  return names[name] ?? name;
}

function formatStatus(status: string): string {
  if (status === "ok") return "Completed";
  if (status === "error") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return "Incomplete";
}

function statusClassName(status: string): string {
  if (status === "ok") return "text-[var(--color-success)]";
  if (status === "error") return "text-[var(--color-danger)]";
  return "text-[var(--color-text-muted)]";
}
