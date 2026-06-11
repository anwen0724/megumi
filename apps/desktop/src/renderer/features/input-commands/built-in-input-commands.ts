import type { CommandDefinition, CommandRegistry } from '../../shared/commands';

export const BUILT_IN_INTENT_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'review',
    kind: 'intent',
    source: 'core',
    description: 'Review code in the current project',
  },
] as const;

export const BUILT_IN_INPUT_COMMAND_REGISTRY: CommandRegistry = {
  intentCommands: BUILT_IN_INTENT_COMMANDS,
};
