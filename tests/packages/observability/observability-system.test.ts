/* Verifies the public Observability lifecycle, privacy boundary and local query projection. */
import { describe, expect, it } from "vitest";
import {
  composeObservability,
  type ObservabilityStorage,
} from "@megumi/observability";

class MemoryStorage implements ObservabilityStorage {
  files = new Map<string, { content: string; modifiedAtMs: number }>();
  async ensureDirectory(): Promise<void> {}
  async appendText(path: string, content: string): Promise<void> {
    const old = this.files.get(path)?.content ?? "";
    this.files.set(path, { content: old + content, modifiedAtMs: Date.now() });
  }
  async readText(path: string): Promise<string> {
    const value = this.files.get(path);
    if (!value) throw new Error("missing");
    return value.content;
  }
  async listFiles(directory: string) {
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(directory))
      .map(([path, value]) => ({
        name: path.split("/").at(-1)!,
        size: value.content.length,
        modifiedAtMs: value.modifiedAtMs,
      }));
  }
  async stat(path: string) {
    const value = this.files.get(path);
    return value
      ? { size: value.content.length, modifiedAtMs: value.modifiedAtMs }
      : undefined;
  }
  async move(source: string, destination: string) {
    const value = this.files.get(source);
    if (value) {
      this.files.set(destination, value);
      this.files.delete(source);
    }
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

describe("Observability system", () => {
  it("records a correlated Run waterfall and projects it after flush", async () => {
    const storage = new MemoryStorage();
    let tick = 0;
    const runtime = composeObservability({
      directoryPath: "/logs",
      storage,
      appVersion: "1",
      platform: "test",
      arch: "x64",
      now: () => new Date(1_000 + tick++),
      monotonicNowMs: () => tick++,
      generateId: () => `id-${tick++}`,
    });
    const trace = runtime.service.startTrace({
      traceId: "R1",
      name: "agent_run",
      runId: "R1",
      sessionId: "S1",
    });
    runtime.service.runInTraceContext(trace, () => {
      const span = runtime.service.startSpan({
        name: "model.call",
        attributes: { providerId: "p", modelId: "m", prompt: "secret" },
      });
      runtime.service.runInSpanContext(span, () =>
        runtime.service.recordMeasurement({
          name: "model.input_tokens",
          value: 12,
          unit: "token",
        }),
      );
      runtime.service.endSpan({ span, status: "ok" });
    });
    runtime.service.endTrace({ trace, status: "ok" });
    await runtime.flush();
    const result = await runtime.queryService.getRunTrace({ runId: "R1" });
    expect(result).toMatchObject({
      status: "found",
      trace: {
        summary: {
          status: "ok",
          modelCallCount: 1,
          inputTokens: 12,
          providerId: "p",
          modelId: "m",
        },
      },
    });
    expect(storage.files.values().next().value?.content).not.toContain(
      "secret",
    );
  });
  it("preserves sibling span parents during parallel async work", async () => {
    const storage = new MemoryStorage();
    const runtime = composeObservability({
      directoryPath: "/logs",
      storage,
      appVersion: "1",
      platform: "test",
      arch: "x",
    });
    const trace = runtime.service.startTrace({
      traceId: "R",
      name: "agent_run",
      runId: "R",
    });
    await runtime.service.runInTraceContext(trace, async () => {
      const root = runtime.service.startSpan({ name: "agent_run" });
      await runtime.service.runInSpanContext(root, () =>
        Promise.all(
          [1, 2].map(async () => {
            const child = runtime.service.startSpan({ name: "tool.call" });
            await runtime.service.runInSpanContext(child, async () =>
              Promise.resolve(),
            );
            runtime.service.endSpan({ span: child, status: "ok" });
          }),
        ),
      );
      runtime.service.endSpan({ span: root, status: "ok" });
    });
    runtime.service.endTrace({ trace, status: "ok" });
    await runtime.flush();
    const result = await runtime.queryService.getRunTrace({ runId: "R" });
    expect(result.status).toBe("found");
    if (result.status === "found") {
      const tools = result.trace.spans.filter(
        (span) => span.name === "tool.call",
      );
      expect(new Set(tools.map((span) => span.parentSpanId)).size).toBe(1);
    }
  });
});
