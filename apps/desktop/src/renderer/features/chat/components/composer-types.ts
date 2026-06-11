// Defines the public Composer payload shape consumed by chat timeline orchestration.
import type {
  InputIntentCommandMetadata,
  InputPreprocessingResult,
} from '@megumi/shared/input';
import type { PermissionModeSelectionSource } from '@megumi/shared/permission';
import type { ComposerModel, ComposerPermissionMode } from './composer-options';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ComposerSubmitPayload {
  message: string;
  permissionMode: ComposerPermissionMode;
  permissionSource?: PermissionModeSelectionSource;
  model: ComposerModel;
  intent?: InputIntentCommandMetadata;
  preprocessing?: InputPreprocessingResult;
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
