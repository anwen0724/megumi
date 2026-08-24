/*
 * Protects deterministic command-name and alias conflict resolution.
 */
import { describe, expect, it } from "vitest";
import { createCommandCatalog } from "../../../packages/agent/commands/src/command-catalog";
import type { CommandDefinition } from "@megumi/commands";

const handle: CommandDefinition["handle"] = async ({ input }) => ({ type: "not_command", input });

describe("CommandCatalog", () => {
  it("keeps the first unambiguous definition", () => {
    const catalog = createCommandCatalog([
      { name: "first", aliases: ["f"], description: "first", handle },
      { name: "second", aliases: ["f"], description: "second", handle },
      { name: "first", description: "duplicate", handle },
    ]);
    expect(catalog.list().map((command) => command.name)).toEqual(["first"]);
    expect(catalog.resolve("f")?.name).toBe("first");
  });
});
