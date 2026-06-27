// Converts ParsedInput facts into Coding Agent run facts without parsing input or executing commands.
import type { ModelInputContextBuildRequest } from '@megumi/shared/model';
import type { ParsedInput, ParsedInputFact } from '@megumi/coding-agent/input';

export type CodingAgentRunInputFact =
  | {
      kind: 'agent_command';
      commandName: string;
      argsText: string;
      rawText: string;
    }
  | {
      kind: 'prompt_template';
      commandName: string;
      argsText: string;
      templateId?: string;
    }
  | {
      kind: 'skill_trigger';
      skillName: string;
      argsText: string;
    }
  | {
      kind: 'app_operation';
      operation: string;
      argsText: string;
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
  switch (fact.kind) {
    case 'command':
      return {
        kind: 'agent_command',
        commandName: fact.commandName,
        argsText: fact.argsText,
        rawText: fact.rawText,
      };
    case 'prompt_template':
      return {
        kind: 'prompt_template',
        commandName: fact.commandName,
        argsText: fact.argsText,
        ...(fact.templateId ? { templateId: fact.templateId } : {}),
      };
    case 'skill':
      return {
        kind: 'skill_trigger',
        skillName: fact.skillName,
        argsText: fact.argsText,
      };
    case 'app_operation':
      return {
        kind: 'app_operation',
        operation: fact.operation,
        argsText: fact.argsText,
      };
  }
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

  switch (fact.kind) {
    case 'agent_command':
      return {
        factId,
        factKind: 'agent_command',
        text: `Agent command ${fact.commandName} was selected with args: ${displayArgs(fact.argsText)}.`,
        required: true,
        metadata: {
          commandName: fact.commandName,
          rawText: fact.rawText,
        },
      };
    case 'prompt_template':
      return {
        factId,
        factKind: 'prompt_template',
        text: `Prompt template command ${fact.commandName} was selected with args: ${displayArgs(fact.argsText)}.`,
        required: true,
        metadata: {
          commandName: fact.commandName,
          ...(fact.templateId ? { templateId: fact.templateId } : {}),
        },
      };
    case 'skill_trigger':
      return {
        factId,
        factKind: 'skill_trigger',
        text: `Skill ${fact.skillName} was triggered with args: ${displayArgs(fact.argsText)}.`,
        required: true,
        metadata: {
          skillName: fact.skillName,
        },
      };
    case 'app_operation':
      return {
        factId,
        factKind: 'app_operation',
        text: `App operation ${fact.operation} was detected with args: ${displayArgs(fact.argsText)}.`,
        required: false,
        metadata: {
          operation: fact.operation,
        },
      };
  }
}

function displayArgs(argsText: string): string {
  const trimmed = argsText.trim();
  return trimmed.length > 0 ? trimmed : '<none>';
}
