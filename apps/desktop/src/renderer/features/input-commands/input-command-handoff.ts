import type { PermissionModeSelectionSource } from '@megumi/shared/permission-mode-contracts';
import type { InputIntentCommandMetadata } from '@megumi/shared/input-command-contracts';
import { createCodeReviewInputIntentMetadata } from '@megumi/shared/input-command-contracts';
import {
  dispatchCommandText,
  listCommandSuggestions,
  type CommandDefinition,
} from '../../shared/commands';
import { BUILT_IN_INPUT_COMMAND_REGISTRY } from './built-in-input-commands';

export interface InputCommandSubmitPayload {
  message: string;
  permissionMode: 'plan';
  permissionSource: PermissionModeSelectionSource;
  intent: InputIntentCommandMetadata;
}

export function listInputCommandSuggestions(inputText: string): CommandDefinition[] {
  return listCommandSuggestions(inputText, BUILT_IN_INPUT_COMMAND_REGISTRY);
}

export function createInputCommandSubmitPayload(message: string): InputCommandSubmitPayload | null {
  const dispatch = dispatchCommandText(message, BUILT_IN_INPUT_COMMAND_REGISTRY);

  if (dispatch.kind === 'send_intent' && dispatch.command.name === 'review') {
    return {
      message: dispatch.rawText,
      permissionMode: 'plan',
      permissionSource: 'intent_default',
      intent: createCodeReviewInputIntentMetadata(dispatch.argsText),
    };
  }

  return null;
}
