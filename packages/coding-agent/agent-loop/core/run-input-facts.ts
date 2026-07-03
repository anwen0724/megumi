// Converts ParsedInput command facts into Coding Agent run facts without parsing input or executing commands.
import type { ModelInputContextBuildRequest } from '@megumi/shared/model';
import type { CommandSource } from '../../commands';
import type { ParsedInput, ParsedInputFact } from '../contracts/run-input-contracts';

export type CodingAgentRunInputFact = {
  kind: 'command';
  name: string;
  source: CommandSource;
  arguments_input: string;
  raw_input: string;
};

export interface CodingAgentRunInputFacts {
  parsedInputId: string;
  rawInputId: string;
  rawKind: ParsedInput['rawKind'];
  inputKind: ParsedInput['kind'];
  effectiveUserText: string;
  facts: CodingAgentRunInputFact[];
}

const MAX_ID_LENGTH = 128;
// The model input context derives a part id of the form
// `part:runtime-fact:${factId}` from each runtime fact. That part id is validated
// against the shared 128-char id schema, so the longest downstream prefix
// (`part:runtime-fact:`) must be reserved here or the run fails validation before
// the model step. Cap fact ids so the derived part id always fits.
const RUNTIME_FACT_PART_PREFIX = 'part:runtime-fact:';
const MAX_FACT_ID_LENGTH = MAX_ID_LENGTH - RUNTIME_FACT_PART_PREFIX.length;

function truncateId(id: string): string {
  return id.length <= MAX_ID_LENGTH ? id : id.slice(0, MAX_ID_LENGTH);
}

function truncateFactId(factId: string): string {
  return factId.length <= MAX_FACT_ID_LENGTH ? factId : factId.slice(0, MAX_FACT_ID_LENGTH);
}

export function createCodingAgentRunInputFacts(parsedInput: ParsedInput): CodingAgentRunInputFacts {
  return {
    parsedInputId: truncateId(String(parsedInput.id)),
    rawInputId: truncateId(String(parsedInput.rawInputId)),
    rawKind: parsedInput.rawKind,
    inputKind: parsedInput.kind,
    effectiveUserText: parsedInput.text,
    facts: parsedInput.facts.map(mapParsedInputFact),
  };
}

export function createRuntimeFactsForRunInput(
  input: CodingAgentRunInputFacts,
): ModelInputContextBuildRequest['runtimeFacts'] {
  const baseFact = {
    factId: truncateFactId(`run-input:${input.parsedInputId}`),
    factKind: 'parsed_input' as const,
    text: `Input kind: ${input.inputKind}. Raw kind: ${input.rawKind}.`,
    required: true,
    metadata: {
      parsedInputId: input.parsedInputId,
      rawInputId: input.rawInputId,
    },
  };

  return [
    baseFact,
    ...input.facts.map((fact, index) => factToRuntimeFact(input.parsedInputId, fact, index + 1)),
  ];
}

function mapParsedInputFact(fact: ParsedInputFact): CodingAgentRunInputFact {
  return {
    kind: 'command',
    name: fact.name,
    source: fact.source,
    arguments_input: fact.arguments_input,
    raw_input: fact.raw_input,
  };
}

function factToRuntimeFact(
  parsedInputId: string,
  fact: CodingAgentRunInputFact,
  index: number,
): ModelInputContextBuildRequest['runtimeFacts'][number] {
  const suffix = `:fact:${index}`;
  const availableLength = MAX_FACT_ID_LENGTH - 'run-input:'.length - suffix.length;
  const truncatedId = parsedInputId.slice(0, Math.max(1, availableLength));
  const factId = `run-input:${truncatedId}${suffix}`;

  return {
    factId,
    factKind: 'agent_command',
    text: `Command ${fact.name} was selected with args: ${displayArgs(fact.arguments_input)}.`,
    required: true,
    metadata: {
      name: fact.name,
      source: fact.source,
      raw_input: fact.raw_input,
    },
  };
}

function displayArgs(arguments_input: string): string {
  const trimmed = arguments_input.trim();
  return trimmed.length > 0 ? trimmed : '<none>';
}
