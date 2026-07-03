/*
 * Provides the public Command Service by composing slash parsing, catalog
 * resolution, and command handler execution.
 */

import {
  createCommandCatalog,
  type CommandCatalog,
} from '../core/command-catalog';
import type {
  CommandDefinition,
  CommandExecutionContext,
  CommandExecutionResult,
  CommandInvocation,
  CommandListItem,
  CommandSuggestionResult,
} from '../contracts/command-contracts';
import { parseSlashCommandInput } from '../core/slash-command-parser';
import type { SkillCommandDescriptor } from '../core/skill-commands';

export type CommandService = {
  listCommands(): CommandListItem[];
  getCommandSuggestions(request: { draft_input: string }): CommandSuggestionResult;
  handleCommandInput(request: { raw_input: string; execution_context?: CommandExecutionContext }): Promise<CommandExecutionResult>;
  executeCommand(request: { invocation: CommandInvocation; execution_context?: CommandExecutionContext }): Promise<CommandExecutionResult>;
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

      return this.executeCommand({
        invocation: parsed.invocation,
        ...(request.execution_context ? { execution_context: request.execution_context } : {}),
      });
    },
    async executeCommand(request) {
      const command = catalog.resolve(request.invocation.name);
      if (!command) {
        return { type: 'not_command', raw_input: request.invocation.raw_input };
      }

      return command.execute({
        invocation: request.invocation,
        ...(request.execution_context ? { execution_context: request.execution_context } : {}),
      });
    },
  };
}
