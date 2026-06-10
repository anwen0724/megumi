import type { PermissionModeSelectionSource } from '@megumi/shared/permission-mode-contracts';
import type { WorkflowCommandMetadata } from '@megumi/shared/workflow-command-contracts';
import type { ComposerModel, ComposerPermissionMode } from './composer-options';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ComposerSubmitPayload {
  message: string;
  permissionMode: ComposerPermissionMode;
  permissionSource?: PermissionModeSelectionSource;
  model: ComposerModel;
  workflow?: WorkflowCommandMetadata;
}

export interface ComposerProps {
  status?: ComposerStatus;
  initialValue?: string;
  seedTextKey?: string | null;
  seedText?: string | null;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachFiles?: () => void;
}
