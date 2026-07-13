/* Lazily loads local Run traces when the user opens the Diagnostics settings page. */
import { useEffect, useState } from "react";
import type { RunTraceDetail, RunTraceSummary } from "@megumi/observability";
import { IPC_CHANNELS } from "../../../main/ipc/channels";
import { createRendererRuntimeIpcRequest } from "../../shared/ipc/runtime-request";
import { Button } from "../../shared/ui";
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Run diagnostics
          </h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Local metadata-only traces for Context, models, tools and session
            commits.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Loading diagnostics…
        </p>
      ) : message ? (
        <p className="text-sm text-[var(--color-danger)]">{message}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-2">
            {traces.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                No Run traces yet.
              </p>
            ) : (
              traces.map((trace) => (
                <button
                  key={trace.runId}
                  onClick={() => void inspect(trace.runId)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:bg-[var(--color-surface-muted)]"
                >
                  <div className="flex justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {trace.runId}
                    </span>
                    <span className="text-xs uppercase text-[var(--color-text-muted)]">
                      {trace.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {trace.durationMs === undefined
                      ? "Duration unavailable"
                      : `${Math.round(trace.durationMs)} ms`}{" "}
                    · {trace.modelCallCount} model · {trace.toolCallCount} tool
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            {!selected ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Select a Run to inspect its timeline.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Timeline</h3>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {selected.summary.inputTokens ?? "—"} in /{" "}
                      {selected.summary.outputTokens ?? "—"} out
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void exportBundle()}
                    >
                      Export bundle
                    </Button>
                  </div>
                </div>
                <ol className="mt-3 space-y-2">
                  {selected.spans.map((span) => (
                    <li
                      key={span.spanId}
                      className="flex justify-between border-l-2 border-[var(--color-border)] pl-3 text-sm"
                    >
                      <span>{span.name}</span>
                      <span className="text-[var(--color-text-muted)]">
                        {span.durationMs === undefined
                          ? "Duration unavailable"
                          : `${Math.round(span.durationMs)} ms`}{" "}
                        · {span.status}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
