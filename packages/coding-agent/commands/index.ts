/*
 * Public exports for the Coding Agent Command module.
 */

export {
  createCommandService,
  type CommandService,
  type CommandSuggestionRequest,
  type SkillCommandProvider,
} from './services/command-service';
export type { SkillCommandDescriptor } from './core/skill-commands';
export type {
  CommandAgentRunInput,
  CommandDefinition,
  CommandExecutionContext,
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
} from './contracts/command-contracts';
