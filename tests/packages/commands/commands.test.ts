/*
 * Protects explicit command handling and Input integration.
 */
import { describe, expect, it, vi } from "vitest";
import { createCommands, createInputCommandHandler } from "@megumi/commands";
import * as PublicCommands from "@megumi/commands";

const input = {
  text: "/review feedback",
  attachments: [{
    draftAttachmentId: "image-1",
    type: "image" as const,
    name: "screen.png",
    mediaType: "image/png" as const,
    byteLength: 8,
    bytes: new Uint8Array([1]),
  }],
};

describe("Commands", () => {
  it("keeps built-in implementation details out of the default public entry", () => {
    expect(PublicCommands).not.toHaveProperty("createBuiltInCommands");
  });

  it("passes /review into Agent execution without losing attachments", async () => {
    const result = await createCommands().handle({
      input,
      context: { workspaceId: "workspace-1" },
    });
    expect(result).toMatchObject({
      type: "agent_run",
      input: { text: "/review feedback", attachments: [{ draftAttachmentId: "image-1" }] },
      command: { name: "review", argumentsInput: "feedback" },
    });
  });

  it("treats unknown slash names and a bare slash as ordinary input", async () => {
    const commands = createCommands();
    await expect(commands.handle({
      input: { text: "/unknown task", attachments: [] },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ type: "not_command", input: { text: "/unknown task" } });
    await expect(commands.handle({
      input: { text: "/", attachments: [] },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ type: "not_command", input: { text: "/" } });
  });

  it("uses the explicitly composed Context compactor and does not start Engine", async () => {
    const compact = vi.fn(async () => ({ status: "compacted" as const }));
    const commands = createCommands({ compact });
    const model = {
      id: "model-1",
      name: "Model",
      api: "openai-responses",
      provider: "openai",
      baseUrl: "https://example.test",
      reasoning: false,
      input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000,
      maxTokens: 100,
    };
    const result = await commands.handle({
      input: { text: "/compact", attachments: [] },
      context: { workspaceId: "workspace-1", sessionId: "session-1", model },
    });
    expect(result).toEqual({ type: "completed", message: "Context compacted." });
    expect(compact).toHaveBeenCalledWith({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      model,
    }, {});
  });

  it("keeps cancellation distinct from command errors", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createCommands().handle({
      input: { text: "/review", attachments: [] },
      context: { workspaceId: "workspace-1" },
    }, { signal: controller.signal })).resolves.toEqual({ type: "cancelled" });
  });

  it("maps a Context cancellation reported after compaction starts to cancelled", async () => {
    let finish!: (result: {
      status: "failed";
      failure: { code: "cancelled"; message: string };
    }) => void;
    const compact = vi.fn(() => new Promise<{
      status: "failed";
      failure: { code: "cancelled"; message: string };
    }>((resolve) => { finish = resolve; }));
    const pending = createCommands({ compact }).handle({
      input: { text: "/compact", attachments: [] },
      context: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        model: {
          id: "model-1",
          name: "Model",
          api: "openai-responses",
          provider: "openai",
          baseUrl: "https://example.test",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 100,
        },
      },
    });
    await vi.waitFor(() => expect(compact).toHaveBeenCalledOnce());
    finish({
      status: "failed",
      failure: { code: "cancelled", message: "Context operation was cancelled." },
    });

    await expect(pending).resolves.toEqual({ type: "cancelled" });
  });

  it("preserves compact host-interaction, no-op, and error branches", async () => {
    const compactInput = {
      input: { text: "/compact", attachments: [] },
      context: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        model: {
          id: "model-1",
          name: "Model",
          api: "openai-responses",
          provider: "openai",
          baseUrl: "https://example.test",
          reasoning: false,
          input: ["text" as const],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 100,
        },
      },
    };
    await expect(createCommands().handle(compactInput)).resolves.toEqual({
      type: "host_interaction_request",
      request: { kind: "context_compaction" },
    });
    await expect(createCommands({
      compact: async () => ({ status: "nothing_to_compact", reason: "no_older_runs" }),
    }).handle(compactInput)).resolves.toEqual({
      type: "completed",
      message: "Context compaction skipped: no_older_runs",
    });
    await expect(createCommands({
      compact: async () => ({
        status: "failed",
        failure: { code: "compaction_failed", message: "Summary failed." },
      }),
    }).handle(compactInput)).resolves.toEqual({ type: "error", message: "Summary failed." });
  });

  it("adapts only handled Commands to the generic Input hook", async () => {
    const handler = createInputCommandHandler(createCommands());
    await expect(handler.handle(
      { text: "/unknown", attachments: [] },
      { workspaceId: "workspace-1" },
    )).resolves.toEqual({ status: "unhandled" });
  });
});
