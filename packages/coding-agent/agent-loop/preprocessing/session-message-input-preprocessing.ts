// Normalizes product input preprocessing before session runs trust it.
import {
  InputPreprocessingResultSchema,
  type InputPreprocessingEntry,
  type InputHookEntry,
  type InputPreprocessingResult,
} from '../contracts/run-input-preprocessing-contracts';
import type { JsonObject } from '@megumi/shared/primitives';
import type { PermissionMode, PermissionModeSelectionSource } from '@megumi/shared/permission';

export interface NormalizeSessionMessageInputPreprocessingInput {
  rawText: string;
  requestedPermissionMode?: PermissionMode;
  requestedPermissionSource?: PermissionModeSelectionSource;
  preprocessing?: InputPreprocessingResult;
  createdAt: string;
}

export interface NormalizedSessionMessageInputPreprocessing {
  effectiveUserText: string;
  permissionMode: PermissionMode;
  permissionSource: PermissionModeSelectionSource;
  inputPreprocessing: InputPreprocessingResult;
  metadata: JsonObject;
}

const DEFAULT_INPUT_HOOK_ENTRY: InputHookEntry = {
  kind: 'input_hook',
  sourceId: 'input:hook:default',
  sourceName: 'default input hook',
  visibility: 'host_only',
  hookId: 'default',
  action: 'continue',
  metadata: {
    action: 'continue',
  },
};

const DEFAULT_INPUT_HOOK_DIAGNOSTIC = {
  code: 'input_hook_continue',
  message: 'Default input hook continued without changes.',
  metadata: {
    hookId: 'default',
  },
} as const;

export function normalizeSessionMessageInputPreprocessing(
  input: NormalizeSessionMessageInputPreprocessingInput,
): NormalizedSessionMessageInputPreprocessing {
  const parsed = InputPreprocessingResultSchema.parse(input.preprocessing ?? {
    originalText: input.rawText,
    effectiveUserText: input.rawText,
    entries: [],
    diagnostics: [],
  });
  assertTrustedInputPreprocessing(parsed);

  const inputPreprocessing = appendDefaultInputHook(parsed);
  const intentDefault = defaultPermissionForInputPreprocessing(inputPreprocessing);
  const permissionMode = intentDefault?.permissionMode
    ?? input.requestedPermissionMode
    ?? 'default';
  const permissionSource = intentDefault?.source
    ?? input.requestedPermissionSource
    ?? 'user';

  return {
    effectiveUserText: inputPreprocessing.effectiveUserText,
    permissionMode,
    permissionSource,
    inputPreprocessing,
    metadata: {
      inputPreprocessing: inputPreprocessing as unknown as JsonObject,
    },
  };
}

function appendDefaultInputHook(input: InputPreprocessingResult): InputPreprocessingResult {
  const hasDefaultHook = input.entries.some((entry) => (
    entry.kind === 'input_hook' && entry.hookId === DEFAULT_INPUT_HOOK_ENTRY.hookId
  ));

  if (hasDefaultHook) {
    return input;
  }

  return {
    ...input,
    entries: [
      ...input.entries,
      DEFAULT_INPUT_HOOK_ENTRY,
    ],
    diagnostics: [
      ...input.diagnostics,
      DEFAULT_INPUT_HOOK_DIAGNOSTIC,
    ],
  };
}

function assertTrustedInputPreprocessing(input: InputPreprocessingResult): void {
  for (const entry of input.entries) {
    if (entry.kind === 'intent') {
      assertTrustedIntentEntry(entry);
    }
  }
}

function assertTrustedIntentEntry(entry: Extract<InputPreprocessingEntry, { kind: 'intent' }>): void {
  if (entry.metadata?.intentName === 'code_review' && entry.commandName !== 'review') {
    throw new Error('Code review input preprocessing must use the review command.');
  }

  if (entry.defaultPermissionSource && !entry.defaultPermissionMode) {
    throw new Error('Input preprocessing defaultPermissionSource requires defaultPermissionMode.');
  }

  if (entry.defaultPermissionMode && entry.defaultPermissionSource !== 'intent_default') {
    throw new Error('Input preprocessing defaultPermissionMode requires intent_default source.');
  }
}

function defaultPermissionForInputPreprocessing(
  input: InputPreprocessingResult,
): { permissionMode: PermissionMode; source: Extract<PermissionModeSelectionSource, 'intent_default'> } | undefined {
  const intentDefaultEntry = input.entries.find((entry) => (
    entry.kind === 'intent'
    && entry.defaultPermissionMode
    && entry.defaultPermissionSource === 'intent_default'
  ));

  if (intentDefaultEntry?.kind === 'intent' && intentDefaultEntry.defaultPermissionMode) {
    return {
      permissionMode: intentDefaultEntry.defaultPermissionMode,
      source: 'intent_default',
    };
  }

  return undefined;
}
