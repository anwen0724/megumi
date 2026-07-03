/*
 * Public exports for the Coding Agent Command module.
 */

export {
  createCommandService,
  type CommandService,
} from './services/command-service';
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
