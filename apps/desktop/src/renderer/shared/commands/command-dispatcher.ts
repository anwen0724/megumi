import type { CommandDefinition, CommandDispatchResult } from './command-types';
import { parseSlashCommand } from './command-parser';

export function listCommandSuggestions(
  inputText: string,
  commands: readonly CommandDefinition[],
): CommandDefinition[] {
  const trimmedStart = inputText.trimStart();

  if (!trimmedStart.startsWith('/')) {
    return [];
  }

  const query = trimmedStart.slice(1);
  if (/\s/.test(query)) {
    return [];
  }

  return commands.filter((command) => command.name.startsWith(query));
}

export function dispatchCommandText(
  rawText: string,
  commands: readonly CommandDefinition[],
): CommandDispatchResult {
  const trimmed = rawText.trim();
  const parsed = parseSlashCommand(trimmed);

  if (!parsed) {
    return { kind: 'fallback', rawText: trimmed };
  }

  const command = commands.find((candidate) => candidate.name === parsed.name);
  if (!command) {
    return { kind: 'fallback', rawText: trimmed };
  }

  return {
    kind: command.kind,
    command,
    rawText: parsed.rawText,
    argsText: parsed.argsText,
  };
}
