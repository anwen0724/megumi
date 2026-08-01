/*
 * Protects executable Command and selectable Skill suggestion separation.
 */
import { describe, expect, it } from "vitest";
import { createCommands } from "@megumi/commands";

describe("Command suggestions", () => {
  it("projects Skills without registering fake Commands or a /skill command", async () => {
    const commands = createCommands({
      skillSuggestionProvider: {
        listSkillSuggestions: () => [
          { name: "research", skillPath: "system/research/SKILL.md", description: "System", sourceLabel: "System" },
          { name: "research", skillPath: "user/research/SKILL.md", description: "User", sourceLabel: "User" },
        ],
      },
    });
    expect(commands.list().map((command) => command.name)).toEqual(["compact", "review"]);
    const suggestions = await commands.suggest({ draftInput: "/res", workspaceId: "workspace-1" });
    expect(suggestions).toMatchObject({
      type: "suggestions",
      groups: [
        { id: "commands", items: [] },
        {
          id: "skills",
          items: [
            { completion: { selection: { skillPath: "system/research/SKILL.md" } } },
            { completion: { selection: { skillPath: "user/research/SKILL.md" } } },
          ],
        },
      ],
    });
    await expect(commands.handle({
      input: { text: "/skill research", attachments: [] },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ type: "not_command" });
  });
});
