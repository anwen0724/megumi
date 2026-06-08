export type CommandKind = 'local' | 'prompt_expansion' | 'workflow';

export interface CommandDefinition {
  name: string;
  kind: CommandKind;
  description: string;
}

export const BUILT_IN_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'review',
    kind: 'workflow',
    description: 'Review code in the current project',
  },
] as const;

export function listCommandSuggestions(
  inputText: string,
  commands: readonly CommandDefinition[] = BUILT_IN_COMMANDS,
): CommandDefinition[] {
  const trimmedStart = inputText.trimStart();

  if (!trimmedStart.startsWith('/')) {
    return [];
  }

  const query = trimmedStart.slice(1);
  const commandPrefix = query.split(/\s/, 1)[0] ?? '';

  return commands.filter((command) => command.name.startsWith(commandPrefix));
}
