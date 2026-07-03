// Converts normalized input preprocessing output into model-visible instruction parts.
import type { InputPreprocessingEntry, InputPreprocessingResult } from '../../contracts/run-input-preprocessing-contracts';
import type { ModelInputContextPart, ModelInputContextSourceRef } from '@megumi/shared/model';
import type { JsonObject } from '@megumi/shared/primitives';

import type { ModelInputContextPartDraft } from '../context-budget';

export function inputPreprocessingInstructionParts(
  inputPreprocessing: InputPreprocessingResult | undefined,
  builtAt: string,
): ModelInputContextPartDraft[] {
  if (!inputPreprocessing) {
    return [];
  }

  return inputPreprocessing.entries
    .filter((entry) => entry.visibility === 'model_visible' && entry.instructionText)
    .map((entry): ModelInputContextPartDraft => ({
      partId: `part:instruction:${inputPreprocessingInstructionKind(entry)}:${inputPreprocessingEntryStableId(entry)}`,
      kind: 'instruction',
      instructionKind: inputPreprocessingInstructionKind(entry),
      text: entry.instructionText ?? '',
      sourceRefs: [inputPreprocessingSourceRef(entry, builtAt)],
      priority: inputPreprocessingPriority(entry),
      metadata: {
        inputPreprocessing: inputPreprocessingMetadata(entry),
      },
    }));
}

export function isInputDerivedInstructionPart(part: ModelInputContextPart): boolean {
  return part.kind === 'instruction'
    && (
      part.instructionKind === 'intent'
      || part.instructionKind === 'prompt_template'
      || part.instructionKind === 'skill'
      || part.instructionKind === 'input_hook'
    );
}

function inputPreprocessingInstructionKind(
  entry: InputPreprocessingEntry,
): Extract<ModelInputContextPartDraft, { kind: 'instruction' }>['instructionKind'] {
  switch (entry.kind) {
    case 'intent':
      return 'intent';
    case 'prompt_template':
      return 'prompt_template';
    case 'skill':
      return 'skill';
    case 'input_hook':
      return 'input_hook';
  }
}

function inputPreprocessingSourceKind(entry: InputPreprocessingEntry): ModelInputContextSourceRef['sourceKind'] {
  switch (entry.kind) {
    case 'intent':
      return 'input_intent';
    case 'prompt_template':
      return 'input_prompt_template';
    case 'skill':
      return 'input_skill';
    case 'input_hook':
      return 'input_hook';
  }
}

function inputPreprocessingEntryStableId(entry: InputPreprocessingEntry): string {
  switch (entry.kind) {
    case 'intent':
      return entry.intentId;
    case 'prompt_template':
      return entry.templateId;
    case 'skill':
      return entry.skillId;
    case 'input_hook':
      return entry.hookId;
  }
}

function inputPreprocessingSourceUri(entry: InputPreprocessingEntry): string {
  return `input://${entry.kind}/${inputPreprocessingEntryStableId(entry)}`;
}

function inputPreprocessingPriority(entry: InputPreprocessingEntry): number {
  switch (entry.kind) {
    case 'intent':
      return 95;
    case 'prompt_template':
    case 'skill':
      return 92;
    case 'input_hook':
      return 88;
  }
}

function inputPreprocessingMetadata(entry: InputPreprocessingEntry): JsonObject {
  const base = {
    sourceName: entry.sourceName,
    ...entry.metadata,
  };

  switch (entry.kind) {
    case 'intent':
      return {
        ...base,
        intentId: entry.intentId,
        commandName: entry.commandName,
        ...(entry.defaultPermissionMode ? { defaultPermissionMode: entry.defaultPermissionMode } : {}),
        ...(entry.defaultPermissionSource ? { defaultPermissionSource: entry.defaultPermissionSource } : {}),
      } as JsonObject;
    case 'prompt_template':
      return {
        ...base,
        templateId: entry.templateId,
        commandName: entry.commandName,
        templateSource: entry.templateSource,
      } as JsonObject;
    case 'skill':
      return {
        ...base,
        skillId: entry.skillId,
        commandName: entry.commandName,
        skillSource: entry.skillSource,
      } as JsonObject;
    case 'input_hook':
      return {
        ...base,
        hookId: entry.hookId,
        action: entry.action,
      } as JsonObject;
  }
}

function inputPreprocessingSourceRef(
  entry: InputPreprocessingEntry,
  builtAt: string,
): ModelInputContextSourceRef {
  return {
    sourceId: entry.sourceId,
    sourceKind: inputPreprocessingSourceKind(entry),
    sourceUri: inputPreprocessingSourceUri(entry),
    loadedAt: builtAt,
    metadata: inputPreprocessingMetadata(entry),
  };
}
