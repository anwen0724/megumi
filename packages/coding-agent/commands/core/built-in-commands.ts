/*
 * Defines Coding Agent built-in slash commands. These commands belong to the
 * product core and must not depend on Desktop, Electron, or UI shell modules.
 */

import type { CommandDefinition } from '../contracts/command-contracts';

export const built_in_commands: CommandDefinition[] = [
  {
    name: 'review',
    description: 'Evaluate review feedback before implementing changes',
    source: { kind: 'built_in' },
    async execute({ invocation }) {
      return {
        type: 'agent_run',
        input: {
          raw_input: invocation.raw_input,
          command: {
            name: invocation.name,
            source: { kind: 'built_in' },
            arguments_input: invocation.arguments_input,
          },
        },
      };
    },
  },
];
