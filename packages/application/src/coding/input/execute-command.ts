/* Owns Coding command discovery, suggestions and execution. */
import type { Skills } from '@megumi/agent-runtime/resources/skills/skills';
import type { Api, Model, Models } from '@megumi/ai';
import type { CommandInputSuggestion, InputSuggestionGroup, InputSuggestionQueryResult, SkillInputSuggestion } from '../session-contracts';
import type { InputContext, InputInterpreter, InputOperationOptions, UserInput } from './parse-message';
import { InputInterpretationError } from './parse-message';
type ModelClient = Pick<Models, 'completeSimple' | 'streamSimple'>;

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
  /** Excludes the command from `/` suggestions without removing it from execution. */
  readonly hiddenFromSuggestions?: boolean;
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

export type SlashCommandParseResult =
  | { readonly type: "not_command"; readonly rawInput: string }
  | { readonly type: "invalid_command"; readonly rawInput: string; readonly reason: "missing_command_name" }
  | { readonly type: "command"; readonly invocation: CommandInvocation };

export function parseSlashCommand(rawInput: string): SlashCommandParseResult {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith("/")) return { type: "not_command", rawInput };
  const body = trimmed.slice(1);
  if (body.trim().length === 0) {
    return { type: "invalid_command", rawInput, reason: "missing_command_name" };
  }
  const firstWhitespace = body.search(/\s/);
  const name = firstWhitespace === -1 ? body : body.slice(0, firstWhitespace);
  const argumentsInput = firstWhitespace === -1 ? "" : body.slice(firstWhitespace + 1).trim();
  return {
    type: "command",
    invocation: { name, argumentsInput, rawInput },
  };
}

export interface CommandCatalog {
  list(): readonly CommandListItem[];
  listDefinitions(): readonly CommandDefinition[];
  resolve(name: string): CommandDefinition | undefined;
}

export function createCommandCatalog(definitions: readonly CommandDefinition[]): CommandCatalog {
  const registered: CommandDefinition[] = [];
  const names = new Map<string, CommandDefinition>();
  const aliases = new Map<string, CommandDefinition>();

  for (const definition of definitions) {
    const aliasList = definition.aliases ?? [];
    if (
      names.has(definition.name)
      || aliases.has(definition.name)
      || new Set(aliasList).size !== aliasList.length
      || aliasList.some((alias) => names.has(alias) || aliases.has(alias))
    ) {
      continue;
    }
    const snapshot: CommandDefinition = {
      ...definition,
      ...(definition.aliases ? { aliases: [...definition.aliases] } : {}),
    };
    registered.push(snapshot);
    names.set(snapshot.name, snapshot);
    for (const alias of aliasList) aliases.set(alias, snapshot);
  }

  const frozen = Object.freeze([...registered]);
  return {
    list() {
      return frozen.map(toListItem);
    },
    listDefinitions() {
      return frozen;
    },
    resolve(name) {
      return names.get(name) ?? aliases.get(name);
    },
  };
}

function toListItem(command: CommandDefinition): CommandListItem {
  return {
    name: command.name,
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    ...(command.hiddenFromSuggestions !== undefined
      ? { hiddenFromSuggestions: command.hiddenFromSuggestions }
      : {}),
  };
}

export interface ContextCompactor {
  compact(
    request: {
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly model: Model<Api>;
      readonly client: ModelClient;
      readonly compactionThresholdRatio: number;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<
    | { readonly status: 'compacted' }
    | { readonly status: 'nothing_to_compact'; readonly reason: string }
    | {
        readonly status: 'failed';
        readonly failure: { readonly code?: string; readonly message: string };
      }
  >;
}

export function createBuiltInCommands(
  options: {
    readonly compact?: ContextCompactor['compact'];
  } = {},
): readonly CommandDefinition[] {
  return [
    {
      name: 'compact',
      description: 'Compact the current session context',
      requiresSession: true,
      async handle({ context }, operationOptions) {
        if (operationOptions?.signal?.aborted) return { type: 'cancelled' };
        if (
          !context.sessionId ||
          !context.model ||
          !context.client ||
          context.compactionThresholdRatio === undefined ||
          !options.compact
        ) {
          return {
            type: 'host_interaction_request',
            request: { kind: 'context_compaction' },
          };
        }
        const result = await options.compact(
          {
            sessionId: context.sessionId,
            workspaceId: context.workspaceId,
            model: context.model,
            client: context.client,
            compactionThresholdRatio: context.compactionThresholdRatio,
          },
          operationOptions,
        );
        if (operationOptions?.signal?.aborted) return { type: 'cancelled' };
        if (result.status === 'failed') {
          return result.failure.code === 'cancelled'
            ? { type: 'cancelled' }
            : { type: 'error', message: result.failure.message };
        }
        if (result.status === 'nothing_to_compact') {
          return { type: 'completed', message: `Context compaction skipped: ${result.reason}` };
        }
        return { type: 'completed', message: 'Context compacted.' };
      },
    },
  ];
}

export interface InputSuggestionQueryRequest {
  readonly draftInput: string;
  readonly workspaceId?: string;
}

export interface InputSuggestionQuery {
  getInputSuggestions(request: InputSuggestionQueryRequest): Promise<InputSuggestionQueryResult>;
}

export function createInputSuggestionQuery(options: {
  readonly commands: Pick<Commands, 'list'>;
  readonly skills: Pick<Skills, 'list'>;
}): InputSuggestionQuery {
  return {
    async getInputSuggestions(request) {
      if (!request.draftInput.trim().startsWith('/')) return { type: 'inactive' };
      // A draft with further text after the command name is no longer a
      // suggestion query; the slash line is already a concrete input.
      const queryPrefix = request.draftInput.trim().slice(1);
      if (/\s/.test(queryPrefix)) return { type: 'inactive' };
      const commandItems: CommandInputSuggestion[] = options.commands.list()
        .filter((command) => !command.hiddenFromSuggestions)
        .flatMap((command) => commandMatchesPrefix(command, queryPrefix));
      const skillResult = await options.skills.list({
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      });
      const skillItems: SkillInputSuggestion[] = skillResult.status === 'ok'
        ? skillResult.skills
            .filter((skill) => skill.available && nameStartsWith(skill.name, queryPrefix))
            .map((skill) => ({
              kind: 'skill',
              name: skill.name,
              description: skill.description,
              ...(skill.source.owner === 'system' ? { sourceLabel: 'System' } : {}),
              match: {
                field: 'name',
                value: skill.name,
                prefix: queryPrefix,
              },
              replacementInput: '',
              selection: { type: 'skill', name: skill.name, skillPath: skill.skillPath },
            }))
        : [];
      const groups: InputSuggestionGroup[] = [];
      if (commandItems.length > 0) {
        groups.push({ id: 'commands', label: 'Commands', items: commandItems });
      }
      if (skillItems.length > 0) {
        groups.push({ id: 'skills', label: 'Skills', items: skillItems });
      }
      return {
        type: 'suggestions',
        draftInput: request.draftInput,
        queryPrefix,
        groups,
      };
    },
  };
}

/** Case-insensitive prefix match; the UI may display humanized names, so typing must not depend on letter case. */
function nameStartsWith(name: string, prefix: string): boolean {
  return name.toLowerCase().startsWith(prefix.toLowerCase());
}

/** Returns the suggestion when the command name or one of its aliases matches the prefix. */
function commandMatchesPrefix(
  command: CommandListItem,
  prefix: string,
): CommandInputSuggestion[] {
  if (nameStartsWith(command.name, prefix)) {
    return [commandSuggestion(command, { field: 'name', value: command.name, prefix })];
  }
  const alias = command.aliases?.find((candidate) => nameStartsWith(candidate, prefix));
  return alias
    ? [commandSuggestion(command, { field: 'alias', value: alias, prefix })]
    : [];
}

function commandSuggestion(
  command: CommandListItem,
  match: CommandInputSuggestion['match'],
): CommandInputSuggestion {
  return {
    kind: 'command',
    name: command.name,
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    match,
    replacementInput: `/${command.name} `,
  };
}
