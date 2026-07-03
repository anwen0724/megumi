// Parses raw input into stable ParsedInput facts without creating runs or context.
import type { CommandAgentRunInput } from '../../commands';
import type { ParsedInput, ParsedInputFact, ParsedInputKind } from '../contracts/run-input-contracts';
import type { RawInputKind } from '../contracts/raw-run-input-contracts';
import { RawInputSchema, type RawInput } from '../contracts/raw-run-input-contracts';

export interface ParseRawInputOptions {
  command?: CommandAgentRunInput['command'];
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
  const facts = createFacts({ command: options.command, raw_input: text });

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

function createFacts(input: {
  command?: CommandAgentRunInput['command'];
  raw_input: string;
}): ParsedInputFact[] {
  if (!input.command) {
    return [];
  }

  return [{
    kind: 'command',
    name: input.command.name,
    source: input.command.source,
    arguments_input: input.command.arguments_input,
    raw_input: input.raw_input,
  }];
}

function selectParsedKind(_facts: ParsedInputFact[]): ParsedInputKind {
  return 'user_input';
}
