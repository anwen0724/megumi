/*
 * Public exports for the Coding Agent Command system. This file intentionally
 * contains no command business logic.
 */

export {
  createCommandService,
  type CommandService,
} from './command-service';
export {
  createCommandCatalog,
  type CommandCatalog,
} from './command-catalog';
export { parseSlashCommandInput, type SlashCommandParseResult } from './slash-command-parser';
export { built_in_commands } from './built-in-commands';
export {
  createSkillCommands,
  type SkillCommandDescriptor,
} from './skill-commands';
export type {
  CommandAgentRunInput,
  CommandDefinition,
  CommandExecutionResult,
  CommandHandler,
  CommandInvocation,
  CommandListItem,
  CommandSource,
  CommandSuggestionGroup,
  CommandSuggestionItem,
  CommandSuggestionResult,
  ExecuteCommandRequest,
  HostInteractionRequest,
} from './command-definition';
