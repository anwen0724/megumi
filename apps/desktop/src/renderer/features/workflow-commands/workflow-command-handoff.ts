import type { PermissionModeSelectionSource } from '@megumi/shared/permission-mode-contracts';
import type { WorkflowCommandMetadata } from '@megumi/shared/workflow-command-contracts';
import { createCodeReviewWorkflowCommandMetadata } from '@megumi/shared/workflow-command-contracts';
import {
  dispatchCommandText,
  listCommandSuggestions,
  type CommandDefinition,
} from '../../shared/commands';
import { BUILT_IN_WORKFLOW_COMMANDS } from './built-in-workflow-commands';

export interface WorkflowCommandSubmitPayload {
  message: string;
  permissionMode: 'plan';
  permissionSource: PermissionModeSelectionSource;
  workflow: WorkflowCommandMetadata;
}

export function listWorkflowCommandSuggestions(inputText: string): CommandDefinition[] {
  return listCommandSuggestions(inputText, BUILT_IN_WORKFLOW_COMMANDS);
}

export function createWorkflowCommandSubmitPayload(message: string): WorkflowCommandSubmitPayload | null {
  const dispatch = dispatchCommandText(message, BUILT_IN_WORKFLOW_COMMANDS);

  if (dispatch.kind === 'workflow' && dispatch.command.name === 'review') {
    return {
      message: dispatch.rawText,
      permissionMode: 'plan',
      permissionSource: 'workflow_default',
      workflow: createCodeReviewWorkflowCommandMetadata(dispatch.argsText),
    };
  }

  return null;
}
