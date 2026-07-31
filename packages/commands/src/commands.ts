/*
 * Defines Commands contracts and composes parsing, catalog lookup, and handlers.
 */
import type {
  InputCommandHandler,
  InputContext,
  InputOperationOptions,
  UserInput,
} from "@megumi/input";
import type { SkillSelection } from "@megumi/skills";
import { createBuiltInCommands, type ContextCompactor } from "./built-in-commands";
import { createCommandCatalog, type CommandCatalog } from "./command-catalog";
import { createCommandSuggestions } from "./command-suggestions";
import { parseSlashCommand } from "./slash-command";

export type CommandSource = { readonly kind: "built_in" };

export interface CommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly argumentHint?: string;
  readonly source: CommandSource;
  readonly requiresSession?: boolean;
  readonly hiddenFromSuggestions?: boolean;
  readonly handle: CommandHandler;
}

export type CommandHandler = (
  request: CommandHandlerRequest,
  options?: CommandOperationOptions,
) => Promise<CommandExecutionResult>;

export interface CommandHandlerRequest {
  readonly invocation: CommandInvocation;
  readonly input: UserInput;
  readonly context: InputContext;
}

export interface CommandInvocation {
  readonly name: string;
  readonly argumentsInput: string;
  readonly rawInput: string;
}

export interface CommandOperationOptions extends InputOperationOptions {}

export interface HandleCommandRequest {
  readonly input: UserInput;
  readonly context: InputContext;
}

export type CommandExecutionResult =
  | { readonly type: "not_command"; readonly input: UserInput }
  | {
      readonly type: "agent_run";
      readonly input: UserInput;
      readonly requestedSkill?: SkillSelection;
      readonly command: {
        readonly name: string;
        readonly source: CommandSource;
        readonly argumentsInput: string;
      };
    }
  | { readonly type: "host_interaction_request"; readonly request: HostInteractionRequest }
  | { readonly type: "completed"; readonly message?: string }
  | { readonly type: "cancelled" }
  | { readonly type: "error"; readonly message: string };

export type CommandTerminalResult = Extract<
  CommandExecutionResult,
  { readonly type: "host_interaction_request" | "completed" | "cancelled" | "error" }
>;

export interface HostInteractionRequest {
  readonly kind: string;
}

export interface CommandListItem {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly argumentHint?: string;
  readonly source: CommandSource;
}

export interface SuggestCommandsRequest {
  readonly draftInput: string;
  readonly workspaceId?: string;
}

export type CommandSuggestionResult =
  | { readonly type: "inactive" }
  | {
      readonly type: "suggestions";
      readonly draftInput: string;
      readonly commandPrefix: string;
      readonly groups: readonly CommandSuggestionGroup[];
    };

export interface CommandSuggestionGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly CommandSuggestionItem[];
}

export interface CommandSuggestionItem {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly argumentHint?: string;
  readonly source:
    | CommandSource
    | { readonly kind: "skill"; readonly name: string; readonly skillPath: string };
  readonly sourceBadge?: string;
  readonly display?: {
    readonly primary: string;
    readonly secondary?: string;
    readonly badge?: string;
  };
  readonly match: {
    readonly field: "name" | "alias";
    readonly value: string;
    readonly prefix: string;
  };
  readonly completion: {
    readonly replacementInput: string;
    readonly selection?: SkillSelection;
  };
}

export interface SkillSuggestionDescriptor {
  readonly name: string;
  readonly skillPath: string;
  readonly description: string;
  readonly sourceLabel: "System" | "User";
}

export interface SkillSuggestionProvider {
  listSkillSuggestions(request: {
    readonly workspaceId?: string;
  }): readonly SkillSuggestionDescriptor[] | Promise<readonly SkillSuggestionDescriptor[]>;
}

export interface Commands {
  handle(
    request: HandleCommandRequest,
    options?: CommandOperationOptions,
  ): Promise<CommandExecutionResult>;
  list(): readonly CommandListItem[];
  suggest(request: SuggestCommandsRequest): Promise<CommandSuggestionResult>;
}

export function createCommands(options: {
  readonly definitions?: readonly CommandDefinition[];
  readonly catalog?: CommandCatalog;
  readonly skillSuggestionProvider?: SkillSuggestionProvider;
  readonly compact?: ContextCompactor["compact"];
} = {}): Commands {
  const definitions = options.definitions ?? createBuiltInCommands({
    ...(options.compact ? { compact: options.compact } : {}),
  });
  const catalog = options.catalog ?? createCommandCatalog(definitions);
  return {
    async handle(request, operationOptions = {}) {
      if (operationOptions.signal?.aborted) return { type: "cancelled" };
      const parsed = parseSlashCommand(request.input.text);
      if (parsed.type !== "command") {
        return { type: "not_command", input: request.input };
      }
      const command = catalog.resolve(parsed.invocation.name);
      if (!command) return { type: "not_command", input: request.input };
      if (command.requiresSession && !request.context.sessionId) {
        return { type: "error", message: "Command requires an existing Session." };
      }
      const result = await command.handle({
        invocation: parsed.invocation,
        input: request.input,
        context: request.context,
      }, operationOptions);
      return operationOptions.signal?.aborted ? { type: "cancelled" } : result;
    },
    list() {
      return catalog.list();
    },
    async suggest(request) {
      const skills = options.skillSuggestionProvider
        ? await options.skillSuggestionProvider.listSkillSuggestions({
            ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
          })
        : [];
      return createCommandSuggestions({
        request,
        commands: catalog.listDefinitions(),
        skills,
      });
    },
  };
}

export function createInputCommandHandler(
  commands: Commands,
): InputCommandHandler<CommandTerminalResult> {
  return {
    async handle(input, context, options) {
      const result = await commands.handle({ input, context }, options);
      if (result.type === "not_command") return { status: "unhandled" };
      if (result.type === "agent_run") {
        return {
          status: "accepted",
          input: result.input,
          ...(result.requestedSkill ? { requestedSkill: result.requestedSkill } : {}),
        };
      }
      return { status: "command_result", result };
    },
  };
}
