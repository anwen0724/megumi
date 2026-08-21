/*
 * Protects explicit command handling and Input Interpretation integration.
 */
import { describe, expect, it, vi } from "vitest";
import { createCommands, createCommandInputInterpreter } from "@megumi/commands";
import * as PublicCommands from "@megumi/commands";

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

function userInput(text: string) {
  return {
    displayContent: [{ type: "text" as const, text }],
    modelContent: [{ type: "text" as const, text }],
    attachments: [],
  };
}

describe("Commands", () => {
  it("keeps built-in implementation details out of the default public entry", () => {
    expect(PublicCommands).not.toHaveProperty("createBuiltInCommands");
  });

  it("does not register /review and treats it as ordinary user input", async () => {
    const commands = createCommands();
    expect(commands.list().map((command) => command.name)).toEqual(["compact"]);
    await expect(commands.handle({
      input: userInput("/review feedback"),
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ type: "not_command" });
  });

  it("treats unknown slash names and a bare slash as ordinary input", async () => {
    const commands = createCommands();
    await expect(commands.handle({
      input: userInput("/unknown task"),
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ type: "not_command" });
    await expect(commands.handle({
      input: userInput("/"),
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ type: "not_command" });
  });

  it("uses the explicitly composed Context compactor and does not start an Agent execution", async () => {
    const compact = vi.fn(async () => ({ status: "compacted" as const }));
    const commands = createCommands({ compact });
    const result = await commands.handle({
      input: userInput("/compact"),
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
      input: userInput("/compact"),
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
      input: userInput("/compact"),
      context: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        model,
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
      input: userInput("/compact"),
      context: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        model,
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

  it("adapts only handled Commands to the Input Interpretation pipeline", async () => {
    const interpreter = createCommandInputInterpreter(createCommands());
    await expect(interpreter.interpret(
      userInput("/unknown"),
      { workspaceId: "workspace-1" },
    )).resolves.toEqual({ status: "unhandled" });
    await expect(interpreter.interpret(
      userInput("/compact"),
      { workspaceId: "workspace-1", sessionId: "session-1", model },
    )).resolves.toEqual({
      status: "completed",
      result: { type: "host_interaction_request", request: { kind: "context_compaction" } },
    });
  });
});
