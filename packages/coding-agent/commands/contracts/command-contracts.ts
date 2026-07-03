/*
 * Defines the stable Command system contracts shared by command definitions,
 * catalog registration, service execution, and input result routing.
 */

export type CommandSource =
  | { kind: 'built_in' }
  | { kind: 'skill'; skill_id: string };

export type CommandDefinition = {
  name: string;
  aliases?: string[];
  description: string;
  argument_hint?: string;
  source: CommandSource;
  execute: CommandHandler;
};

export type CommandHandler = (
  request: ExecuteCommandRequest,
) => Promise<CommandExecutionResult>;

export type ExecuteCommandRequest = {
  invocation: CommandInvocation;
  execution_context?: CommandExecutionContext;
};

export type CommandExecutionContext = {
  session_id: string;
  workspace_id?: string;
  services?: {
    context_compaction?: {
      compact(request: {
        session_id: string;
        workspace_id?: string;
        trigger: { kind: 'manual'; requested_by: 'command' };
      }): Promise<
        | { status: 'completed' }
        | { status: 'skipped'; reason: string }
        | { status: 'failed'; failure: { message: string } }
      >;
    };
  };
};

export type CommandInvocation = {
  name: string;
  arguments_input: string;
  raw_input: string;
};

export type CommandExecutionResult =
  | { type: 'not_command'; raw_input: string }
  | { type: 'agent_run'; input: CommandAgentRunInput }
  | { type: 'host_interaction_request'; request: HostInteractionRequest }
  | { type: 'completed'; message?: string }
  | { type: 'error'; message: string };

export type CommandAgentRunInput = {
  raw_input: string;
  command: {
    name: string;
    source: CommandSource;
    arguments_input: string;
  };
};

export type HostInteractionRequest = {
  kind: string;
};

export type CommandListItem = {
  name: string;
  aliases?: string[];
  description: string;
  argument_hint?: string;
  source: CommandSource;
};

export type CommandSuggestionResult =
  | { type: 'inactive' }
  | {
      type: 'suggestions';
      draft_input: string;
      command_prefix: string;
      groups: CommandSuggestionGroup[];
    };

export type CommandSuggestionGroup = {
  id: string;
  label: string;
  items: CommandSuggestionItem[];
};

export type CommandSuggestionItem = {
  name: string;
  aliases?: string[];
  description: string;
  argument_hint?: string;
  source: CommandSource;
  source_badge?: string;
  match: {
    field: 'name' | 'alias';
    value: string;
    prefix: string;
  };
  completion: {
    replacement_input: string;
  };
};
