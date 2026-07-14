/* Lazily loads local Run traces when the user opens the Diagnostics settings page. */
import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { RunTraceDetail, RunTraceSummary } from "@megumi/observability";
import { IPC_CHANNELS } from "../../../main/ipc/channels";
import { createRendererRuntimeIpcRequest } from "../../shared/ipc/runtime-request";
import { Button, SettingsPageHeader, cx } from "../../shared/ui";
export function DiagnosticsPanel() {
  const [traces, setTraces] = useState<RunTraceSummary[]>([]);
  const [selected, setSelected] = useState<RunTraceDetail>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const load = async () => {
    setLoading(true);
    const result = await window.megumi.observability.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.observability.list, {
        limit: 50,
      }),
    );
    if (result.ok && result.data.status === "ok") setTraces(result.data.traces);
    else setMessage("Diagnostics are unavailable.");
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);
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
              <span className="text-xs text-[var(--color-text-subtle)]">{traces.length}</span>
            </div>
            {traces.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                No activity recorded yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {traces.map((trace) => (
                <button
                  key={trace.runId}
                  onClick={() => void inspect(trace.runId)}
                  className={cx(
                    "relative w-full cursor-pointer rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                    selected?.summary.runId === trace.runId
                      ? "border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]"
                      : "border-transparent hover:bg-[var(--color-surface-muted)]",
                  )}
                >
                  <div className="flex justify-between gap-3">
                    <span className="truncate font-mono text-xs font-medium text-[var(--color-text)]">
                      {shortRunId(trace.runId)}
                    </span>
                    <span className={cx("text-xs font-medium", statusClassName(trace.status))}>
                      {formatStatus(trace.status)}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {trace.durationMs === undefined
                      ? "Duration unavailable"
                      : `${Math.round(trace.durationMs)} ms`}{" "}
                    · {trace.modelCallCount} model · {trace.toolCallCount} tool
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
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--color-text)]">Execution timeline</h2>
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
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                <ol className="mt-5 space-y-1">
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

function shortRunId(runId: string): string {
  const value = runId.replace(/^run:/, "");
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
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
