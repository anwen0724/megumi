/* Verifies that Agent Run trace facts enrich Observability without duplicating owner spans. */
import { describe, expect, it } from "vitest";
import {
  composeObservability,
  type ObservabilityStorage,
} from "@megumi/observability";
import { createObservabilityAgentRunTraceLogger } from "@megumi/agent/composition/compose-agent-runtime";

class MemoryStorage implements ObservabilityStorage {
  private readonly files = new Map<string, string>();

  async ensureDirectory(): Promise<void> {}
  async appendText(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + content);
  }
  async readText(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error("missing");
    return content;
  }
  async listFiles(directory: string) {
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(directory))
      .map(([path, content]) => ({
        name: path.split("/").at(-1)!,
        size: content.length,
        modifiedAtMs: Date.now(),
      }));
  }
  async stat(path: string) {
    const content = this.files.get(path);
    return content === undefined
      ? undefined
      : { size: content.length, modifiedAtMs: Date.now() };
  }
  async move(source: string, destination: string): Promise<void> {
    const content = this.files.get(source);
    if (content === undefined) return;
    this.files.set(destination, content);
    this.files.delete(source);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

describe("Observability Agent Run trace logger", () => {
  it("records nested provider usage and ignores the duplicate prompt-built span", async () => {
    const storage = new MemoryStorage();
    const runtime = composeObservability({
      directoryPath: "/logs",
      storage,
      appVersion: "test",
      platform: "test",
      arch: "x64",
    });
    const logger = createObservabilityAgentRunTraceLogger(runtime.service);
    const trace = runtime.service.startTrace({
      traceId: "run-1",
      name: "agent_run",
      runId: "run-1",
      sessionId: "session-1",
    });

    runtime.service.runInTraceContext(trace, () => {
      logger.record({
        trace_id: "run-1",
        run_id: "run-1",
        session_id: "session-1",
        event_type: "trace.prompt.built",
        payload: {},
      });
      logger.record({
        trace_id: "run-1",
        run_id: "run-1",
        session_id: "session-1",
        model_call_id: "model-call-1",
        event_type: "trace.model_call.request_payload",
        payload: { provider_id: "provider", model_id: "model" },
      });
      logger.record({
        trace_id: "run-1",
        run_id: "run-1",
        session_id: "session-1",
        model_call_id: "model-call-1",
        event_type: "trace.model_call.event_received",
        payload: {
          event: {
            type: "completed",
            usage: { input_tokens: 120, output_tokens: 30 },
          },
        },
      });
    });
    runtime.service.endTrace({ trace, status: "ok" });
    await runtime.flush();

    const result = await runtime.queryService.getRunTrace({ runId: "run-1" });
    expect(result.status).toBe("found");
    if (result.status !== "found") return;

    expect(
      result.trace.spans.filter(
        (span) => span.name === "context.prepare_model_call",
      ),
    ).toHaveLength(0);
    expect(
      result.trace.spans.filter((span) => span.name === "model.call"),
    ).toHaveLength(1);
    expect(result.trace.summary).toMatchObject({
      providerInputTokens: 120,
      providerOutputTokens: 30,
    });
  });
});
