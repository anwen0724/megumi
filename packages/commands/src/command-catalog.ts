/*
 * Owns immutable command registration, conflict checks, and name resolution.
 */
import type { CommandDefinition, CommandListItem } from "./commands";

export interface CommandCatalog {
  list(): readonly CommandListItem[];
  listDefinitions(): readonly CommandDefinition[];
  resolve(name: string): CommandDefinition | undefined;
}

export function createCommandCatalog(definitions: readonly CommandDefinition[]): CommandCatalog {
  const registered: CommandDefinition[] = [];
  const names = new Map<string, CommandDefinition>();
  const aliases = new Map<string, CommandDefinition>();

  for (const definition of definitions) {
    const aliasList = definition.aliases ?? [];
    if (
      names.has(definition.name)
      || aliases.has(definition.name)
      || new Set(aliasList).size !== aliasList.length
      || aliasList.some((alias) => names.has(alias) || aliases.has(alias))
    ) {
      continue;
    }
    const snapshot: CommandDefinition = {
      ...definition,
      ...(definition.aliases ? { aliases: [...definition.aliases] } : {}),
    };
    registered.push(snapshot);
    names.set(snapshot.name, snapshot);
    for (const alias of aliasList) aliases.set(alias, snapshot);
  }

  const frozen = Object.freeze([...registered]);
  return {
    list() {
      return frozen.map(toListItem);
    },
    listDefinitions() {
      return frozen;
    },
    resolve(name) {
      return names.get(name) ?? aliases.get(name);
    },
  };
}

function toListItem(command: CommandDefinition): CommandListItem {
  return {
    name: command.name,
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
  };
}
