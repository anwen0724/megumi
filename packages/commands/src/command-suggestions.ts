/*
 * Projects executable Commands and selectable Skills into slash suggestions.
 */
import type {
  CommandDefinition,
  CommandSuggestionGroup,
  CommandSuggestionItem,
  CommandSuggestionResult,
  SkillSuggestionDescriptor,
  SuggestCommandsRequest,
} from "./commands";

export function createCommandSuggestions(input: {
  readonly request: SuggestCommandsRequest;
  readonly commands: readonly CommandDefinition[];
  readonly skills: readonly SkillSuggestionDescriptor[];
}): CommandSuggestionResult {
  const draft = input.request.draftInput;
  const commandDraft = draft.trimStart();
  if (!commandDraft.startsWith("/")) return { type: "inactive" };
  const body = commandDraft.slice(1);
  if (/\s/.test(body)) return { type: "inactive" };
  const commandPrefix = body;
  return {
    type: "suggestions",
    draftInput: draft,
    commandPrefix,
    groups: [
      {
        id: "commands",
        label: "Commands",
        items: input.commands
          .filter((command) => !command.hiddenFromSuggestions)
          .flatMap((command) => commandSuggestions(command, commandPrefix)),
      },
      {
        id: "skills",
        label: "Skills",
        items: input.skills.flatMap((skill) => skillSuggestions(skill, commandPrefix)),
      },
    ],
  };
}

function commandSuggestions(
  command: CommandDefinition,
  prefix: string,
): readonly CommandSuggestionItem[] {
  if (command.name.startsWith(prefix)) {
    return [commandSuggestion(command, { field: "name", value: command.name, prefix })];
  }
  const alias = command.aliases?.find((candidate) => candidate.startsWith(prefix));
  return alias
    ? [commandSuggestion(command, { field: "alias", value: alias, prefix })]
    : [];
}

function commandSuggestion(
  command: CommandDefinition,
  match: CommandSuggestionItem["match"],
): CommandSuggestionItem {
  return {
    name: command.name,
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    source: command.source,
    match,
    completion: { replacementInput: `/${command.name} ` },
  };
}

function skillSuggestions(
  skill: SkillSuggestionDescriptor,
  prefix: string,
): readonly CommandSuggestionItem[] {
  if (!skill.name.startsWith(prefix)) return [];
  return [{
    name: skill.name,
    description: skill.description,
    source: { kind: "skill", name: skill.name, skillPath: skill.skillPath },
    sourceBadge: skill.sourceLabel,
    display: {
      primary: skill.name,
      secondary: skill.description,
      badge: skill.sourceLabel,
    },
    match: { field: "name", value: skill.name, prefix },
    completion: {
      replacementInput: "",
      selection: { type: "skill", name: skill.name, skillPath: skill.skillPath },
    },
  }];
}
