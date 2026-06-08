import type { CommandDefinition } from './command-registry';
import { BUILT_IN_COMMANDS } from './command-registry';
import { parseSlashCommand } from './command-parser';

export type CommandDispatchResult =
  | { kind: 'local'; command: CommandDefinition; rawText: string; argsText: string }
  | { kind: 'prompt_expansion'; command: CommandDefinition; rawText: string; argsText: string }
  | { kind: 'workflow'; command: CommandDefinition; rawText: string; argsText: string }
  | { kind: 'fallback'; rawText: string };

export function dispatchCommandText(
  rawText: string,
  commands: readonly CommandDefinition[] = BUILT_IN_COMMANDS,
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
