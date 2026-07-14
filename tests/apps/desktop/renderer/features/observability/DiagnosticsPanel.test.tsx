// @vitest-environment jsdom
/* Verifies that Run diagnostics distinguish Prompt capacity from provider usage. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsPanel } from "@megumi/desktop/renderer/features/observability";

describe("DiagnosticsPanel", () => {
  const list = vi.fn();
  const get = vi.fn();
  const createBundle = vi.fn();

  beforeEach(() => {
    list.mockReset().mockResolvedValue({
      ok: true,
      data: {
        status: "ok",
        traces: [summary],
      },
      meta: {},
    });
    get.mockReset().mockResolvedValue({
      ok: true,
      data: {
        status: "found",
        trace: {
          summary,
          spans: [
            {
              spanId: "span-1",
              name: "context.prepare_model_call",
              status: "ok",
              startedAt: "2026-07-14T00:00:00.000Z",
              endedAt: "2026-07-14T00:00:00.010Z",
              durationMs: 10,
              attributes: {},
            },
          ],
          logs: [],
          measurements: [],
          droppedRecordCount: 0,
        },
      },
      meta: {},
    });
    createBundle.mockReset();
    Object.defineProperty(window, "megumi", {
      configurable: true,
      value: { observability: { list, get, createBundle } },
    });
  });

  it("shows Context capacity and provider-reported tokens separately", async () => {
    const user = userEvent.setup();
    render(<DiagnosticsPanel />);

    await user.click(await screen.findByRole("button", { name: /run-1/ }));

    expect(await screen.findByText("14,335 / 1,000,000")).toBeInTheDocument();
    expect(screen.getByText("1.43% of the context window")).toBeInTheDocument();
    expect(screen.getByText("14,480 in · 620 out")).toBeInTheDocument();
    expect(screen.getByText("Build context")).toBeInTheDocument();
    expect(screen.queryByText("context.prepare_model_call")).not.toBeInTheDocument();
  });
});

const summary = {
  traceId: "run-1",
  runId: "run-1",
  status: "ok" as const,
  startedAt: "2026-07-14T00:00:00.000Z",
  durationMs: 100,
  modelCallCount: 1,
  toolCallCount: 0,
  contextUsedTokens: 14_335,
  contextWindowTokens: 1_000_000,
  contextUsedRatio: 14_335 / 1_000_000,
  providerInputTokens: 14_480,
  providerOutputTokens: 620,
};
