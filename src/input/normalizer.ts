// Parses raw input into stable ParsedInput facts without creating runs or context.
import {
  dispatchCommandText,
  type CommandDispatchResult,
  type CommandRegistry,
} from '../command';
import type { ParsedInput, ParsedInputFact, ParsedInputKind } from './parsed-input';
import type { RawInputKind } from './raw-input';
import { RawInputSchema, type RawInput } from './raw-input';

export interface ParseRawInputOptions {
  commandRegistry?: CommandRegistry;
  now?: () => string;
  createId?: (prefix: string, value: string) => string;
}

export interface NormalizeRawInputOptions extends ParseRawInputOptions {
  rawInput: RawInput;
}

export function parseRawInput(rawInput: RawInput, options?: ParseRawInputOptions): ParsedInput;
export function parseRawInput(options: NormalizeRawInputOptions): ParsedInput;
export function parseRawInput(
  rawInputOrOptions: RawInput | NormalizeRawInputOptions,
  maybeOptions: ParseRawInputOptions = {},
): ParsedInput {
  const { rawInput, options } = resolveParseInputArgs(rawInputOrOptions, maybeOptions);
  const parsedRawInput = RawInputSchema.parse(rawInput) as RawInput;
  const createId = options.createId ?? ((prefix: string, value: string) => `${prefix}_${value}`);
  const now = options.now ?? (() => new Date().toISOString());
  const text = parsedRawInput.text ?? '';
  const rawKind = parsedRawInput.kind ?? inferInputKind(text, parsedRawInput);
  const commandDispatch = options.commandRegistry ? dispatchCommandText(text, options.commandRegistry) : undefined;
  const facts = createFacts(commandDispatch);

  return {
    id: createId('parsed-input', String(parsedRawInput.id)),
    rawInputId: parsedRawInput.id,
    source: parsedRawInput.source,
    rawKind,
    kind: selectParsedKind(facts),
    text,
    attachments: parsedRawInput.attachments ?? [],
    references: parsedRawInput.references ?? [],
    ...(parsedRawInput.target ? { target: parsedRawInput.target } : {}),
    facts,
    ...(parsedRawInput.metadata ? { metadata: parsedRawInput.metadata } : {}),
    createdAt: parsedRawInput.createdAt || now(),
  };
}

export const normalizeRawInput = parseRawInput;

function resolveParseInputArgs(
  rawInputOrOptions: RawInput | NormalizeRawInputOptions,
  maybeOptions: ParseRawInputOptions,
): { rawInput: RawInput; options: ParseRawInputOptions } {
  if ('rawInput' in rawInputOrOptions) {
    const { rawInput, ...options } = rawInputOrOptions;
    return { rawInput, options };
  }

  return { rawInput: rawInputOrOptions, options: maybeOptions };
}

function inferInputKind(text: string, rawInput: RawInput): RawInputKind {
  if (text.trimStart().startsWith('/')) {
    return 'slash_command';
  }
  if (text.trim()) {
    return 'text';
  }
  if ((rawInput.attachments?.length ?? 0) > 0) {
    return 'attachment';
  }
  if ((rawInput.references?.length ?? 0) > 0) {
    return 'reference';
  }
  return rawInput.source.kind === 'system' ? 'system' : 'text';
}

function createFacts(dispatch: CommandDispatchResult | undefined): ParsedInputFact[] {
  if (!dispatch || dispatch.kind === 'fallback') {
    return [];
  }

  if (dispatch.target.kind === 'agent_command') {
    return [{
      kind: 'command',
      commandName: dispatch.commandName,
      argsText: dispatch.argsText,
      rawText: dispatch.rawText,
      target: 'agent_command',
    }];
  }

  if (dispatch.target.kind === 'prompt_template') {
    return [{
      kind: 'prompt_template',
      commandName: dispatch.commandName,
      argsText: dispatch.argsText,
      templateId: dispatch.target.templateId,
    }];
  }

  if (dispatch.target.kind === 'skill_trigger') {
    return [{
      kind: 'skill',
      skillName: dispatch.target.skillName,
      argsText: dispatch.argsText,
      source: 'command',
    }];
  }

  if (dispatch.target.kind === 'app_operation') {
    return [{
      kind: 'app_operation',
      operation: dispatch.target.operation,
      argsText: dispatch.argsText,
      source: 'command',
    }];
  }

  return [{
    kind: 'command',
    commandName: dispatch.commandName,
    argsText: dispatch.argsText,
    rawText: dispatch.rawText,
    target: 'agent_command',
  }];
}

function selectParsedKind(facts: ParsedInputFact[]): ParsedInputKind {
  if (facts.some((fact) => fact.kind === 'app_operation')) {
    return 'app_operation';
  }
  if (facts.some((fact) => fact.kind === 'skill')) {
    return 'skill_input';
  }
  if (facts.length > 0) {
    return 'command_input';
  }

  return 'user_input';
}
