// Defines the public Composer payload shape consumed by chat timeline orchestration.
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type { PermissionModeSelectionSource } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { ComposerModel, ComposerPermissionMode } from './composer-options';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ComposerSubmitPayload {
  message: string;
  permissionMode: ComposerPermissionMode;
  permissionSource?: PermissionModeSelectionSource;
  model: ComposerModel;
  preprocessing?: InputPreprocessingResult;
}

export interface ComposerProps {
  status?: ComposerStatus;
  initialValue?: string;
  enabledProviderIds?: ProviderId[];
  seedTextKey?: string | null;
  seedText?: string | null;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachFiles?: () => void;
}
