// Defines Megumi-owned built-in input commands for the new src command boundary.
import type { CommandDefinition } from './definition';
import { createCommandRegistry } from './registry';

export const REVIEW_AGENT_COMMAND_DESCRIPTION = 'Review code in the current project';

export const BUILT_IN_AGENT_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'review',
    kind: 'agent_command',
    source: 'core',
    description: REVIEW_AGENT_COMMAND_DESCRIPTION,
    dispatch: {
      kind: 'agent_command',
      commandName: 'review',
      description: REVIEW_AGENT_COMMAND_DESCRIPTION,
    },
  },
] as const;

export const BUILT_IN_INPUT_COMMAND_REGISTRY = createCommandRegistry({
  agentCommands: BUILT_IN_AGENT_COMMANDS,
});
