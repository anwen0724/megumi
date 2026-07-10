/*
 * Builds and owns the registered command catalog. It resolves command names and
 * aliases to definitions, while keeping conflict diagnostics internal.
 */

import { built_in_commands as defaultBuiltInCommands } from './built-in-commands';
import type {
  CommandDefinition,
  CommandListItem,
  CommandSuggestionItem,
  CommandSuggestionGroup,
  CommandSuggestionResult,
} from '../contracts/command-contracts';
import { createSkillCommands, type SkillCommandDescriptor } from './skill-commands';

export type CommandCatalog = {
  listCommands(): CommandListItem[];
  resolve(name: string): CommandDefinition | undefined;
  getCommandSuggestions(request: { draft_input: string }): CommandSuggestionResult;
};

type CommandCatalogDiagnostic = {
  command_name: string;
  reason: 'duplicate_name' | 'duplicate_alias' | 'alias_conflicts_with_name';
};

export function createCommandCatalog(options: {
  built_in_commands?: CommandDefinition[];
  skill_commands?: CommandDefinition[];
  skills?: readonly SkillCommandDescriptor[];
} = {}): CommandCatalog {
  const diagnostics: CommandCatalogDiagnostic[] = [];
  const registered: CommandDefinition[] = [];
  const names = new Map<string, CommandDefinition>();
  const aliases = new Map<string, CommandDefinition>();

  const definitions = [
    ...(options.built_in_commands ?? defaultBuiltInCommands),
    ...(options.skill_commands ?? createSkillCommands({ skills: options.skills })),
  ];

  for (const definition of definitions) {
    const aliasList = definition.aliases ?? [];
    const aliasesAreUnique = new Set(aliasList).size === aliasList.length;
    const hasNameConflict = names.has(definition.name) || aliases.has(definition.name);
    const hasAliasConflict = aliasList.some((alias) => names.has(alias) || aliases.has(alias));

    if (hasNameConflict) {
      diagnostics.push({ command_name: definition.name, reason: 'duplicate_name' });
      if (definition.source.kind === 'skill') {
        registered.push(definition);
      }
      continue;
    }
    if (!aliasesAreUnique) {
      diagnostics.push({ command_name: definition.name, reason: 'duplicate_alias' });
      continue;
    }
    if (hasAliasConflict) {
      diagnostics.push({ command_name: definition.name, reason: 'alias_conflicts_with_name' });
      if (definition.source.kind === 'skill') {
        registered.push(definition);
      }
      continue;
    }

    registered.push(definition);
    names.set(definition.name, definition);
    for (const alias of aliasList) {
      aliases.set(alias, definition);
    }
  }

  void diagnostics;

  return {
    listCommands() {
      return registered.map(toListItem);
    },
    resolve(name: string) {
      return names.get(name) ?? aliases.get(name);
    },
    getCommandSuggestions(request) {
      return getCommandSuggestions({ request, commands: registered });
    },
  };
}

function getCommandSuggestions(input: {
  request: { draft_input: string };
  commands: CommandDefinition[];
}): CommandSuggestionResult {
  const draft = input.request.draft_input;
  const commandDraft = draft.trimStart();
  if (!commandDraft.startsWith('/')) {
    return { type: 'inactive' };
  }

  const body = commandDraft.slice(1);
  if (/\s/.test(body)) {
    return { type: 'inactive' };
  }

  const command_prefix = body;
  const groups: CommandSuggestionGroup[] = [
    {
      id: 'commands',
      label: 'Commands',
      items: input.commands
        .filter((command) => command.source.kind === 'built_in')
        .flatMap((command) => toSuggestionItem(command, command_prefix)),
    },
    {
      id: 'skills',
      label: 'Skills',
      items: input.commands
        .filter((command) => command.source.kind === 'skill')
        .flatMap((command) => toSuggestionItem(command, command_prefix)),
    },
  ];

  return {
    type: 'suggestions',
    draft_input: draft,
    command_prefix,
    groups,
  };
}

function toListItem(command: CommandDefinition): CommandListItem {
  return {
    name: command.name,
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    description: command.description,
    ...(command.argument_hint ? { argument_hint: command.argument_hint } : {}),
    source: command.source,
  };
}

function toSuggestionItem(
  command: CommandDefinition,
  prefix: string,
): CommandSuggestionGroup['items'] {
  if (command.name.startsWith(prefix)) {
    return [createSuggestion(command, { field: 'name', value: command.name, prefix })];
  }

  const matchingAlias = command.aliases?.find((alias) => alias.startsWith(prefix));
  if (!matchingAlias) {
    return [];
  }

  return [createSuggestion(command, { field: 'alias', value: matchingAlias, prefix })];
}

function createSuggestion(
  command: CommandDefinition,
  match: CommandSuggestionItem['match'],
): CommandSuggestionItem {
  return {
    ...toListItem(command),
    ...(command.suggestion?.source_badge ? { source_badge: command.suggestion.source_badge } : {}),
    ...(command.suggestion?.primary ? {
      display: {
        primary: command.suggestion.primary,
        ...(command.suggestion.secondary ? { secondary: command.suggestion.secondary } : {}),
        ...(command.suggestion.badge ? { badge: command.suggestion.badge } : {}),
      },
    } : {}),
    match,
    completion: {
      replacement_input: command.suggestion?.replacement_input ?? `/${command.name} `,
    },
  };
}
