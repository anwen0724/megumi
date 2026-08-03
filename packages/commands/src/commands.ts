/*
 * Defines Commands contracts and composes parsing, catalog lookup, and handlers.
 * Commands only execute registered built-in commands; unregistered slash text
 * remains ordinary user input. Suggestions are owned by Product, not Commands.
 */
import {
  InputInterpretationError,
  type InputContext,
  type InputInterpreter,
  type InputOperationOptions,
  type UserInput,
} from "@megumi/input";
import { createBuiltInCommands, type ContextCompactor } from "./built-in-commands";
import { createCommandCatalog, type CommandCatalog } from "./command-catalog";
import { parseSlashCommand } from "./slash-command";

export interface CommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly argumentHint?: string;
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
}

export interface Commands {
  handle(
    request: HandleCommandRequest,
    options?: CommandOperationOptions,
  ): Promise<CommandExecutionResult>;
  list(): readonly CommandListItem[];
}

export function createCommands(options: {
  readonly definitions?: readonly CommandDefinition[];
  readonly catalog?: CommandCatalog;
  readonly compact?: ContextCompactor["compact"];
} = {}): Commands {
  const definitions = options.definitions ?? createBuiltInCommands({
    ...(options.compact ? { compact: options.compact } : {}),
  });
  const catalog = options.catalog ?? createCommandCatalog(definitions);
  return {
    async handle(request, operationOptions = {}) {
      if (operationOptions.signal?.aborted) return { type: "cancelled" };
      const parsed = parseSlashCommand(userInputText(request.input));
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
  };
}

/** Maps Commands into the fixed Input Interpretation pipeline. */
export function createCommandInputInterpreter(
  commands: Commands,
): InputInterpreter<CommandTerminalResult> {
  return {
    async interpret(input, context, options) {
      const result = await commands.handle({ input, context }, options);
      if (result.type === "not_command") return { status: "unhandled" };
      if (result.type === "completed" || result.type === "host_interaction_request") {
        return { status: "completed", result };
      }
      if (result.type === "cancelled") {
        throw new InputInterpretationError({
          code: "input_cancelled",
          message: "Command execution was cancelled.",
        });
      }
      throw new InputInterpretationError({
        code: "input_interpretation_failed",
        message: result.message,
      });
    },
  };
}

export function userInputText(input: UserInput): string {
  return input.displayContent.map((block) => block.text).join("");
}
