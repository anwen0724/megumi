/*
 * Provides the public Command Service by composing slash parsing, catalog
 * resolution, and command handler execution.
 */

import {
  createCommandCatalog,
  type CommandCatalog,
} from './command-catalog';
import type {
  CommandDefinition,
  CommandExecutionResult,
  CommandInvocation,
  CommandListItem,
  CommandSuggestionResult,
} from './command-definition';
import { parseSlashCommandInput } from './slash-command-parser';
import type { SkillCommandDescriptor } from './skill-commands';

export type CommandService = {
  listCommands(): CommandListItem[];
  getCommandSuggestions(request: { draft_input: string }): CommandSuggestionResult;
  handleCommandInput(request: { raw_input: string }): Promise<CommandExecutionResult>;
  executeCommand(request: { invocation: CommandInvocation }): Promise<CommandExecutionResult>;
};

export function createCommandService(options: {
  built_in_commands?: CommandDefinition[];
  skill_commands?: CommandDefinition[];
  skills?: readonly SkillCommandDescriptor[];
  catalog?: CommandCatalog;
} = {}): CommandService {
  const catalog = options.catalog ?? createCommandCatalog({
    ...(options.built_in_commands ? { built_in_commands: options.built_in_commands } : {}),
    ...(options.skill_commands ? { skill_commands: options.skill_commands } : {}),
    ...(options.skills ? { skills: options.skills } : {}),
  });

  return {
    listCommands() {
      return catalog.listCommands();
    },
    getCommandSuggestions(request) {
      return catalog.getCommandSuggestions(request);
    },
    async handleCommandInput(request) {
      const parsed = parseSlashCommandInput(request.raw_input);
      if (parsed.type !== 'command') {
        return { type: 'not_command', raw_input: request.raw_input };
      }

      return this.executeCommand({ invocation: parsed.invocation });
    },
    async executeCommand(request) {
      const command = catalog.resolve(request.invocation.name);
      if (!command) {
        return { type: 'not_command', raw_input: request.invocation.raw_input };
      }

      return command.execute({ invocation: request.invocation });
    },
  };
}
