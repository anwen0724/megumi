// Defines the public Composer payload shape consumed by chat timeline orchestration.
import type { PermissionModeSelectionSource } from '@megumi/shared/permission';
import type { ProviderPublicStatus } from '@megumi/shared/provider';
import type { CommandSuggestionResult } from '@megumi/coding-agent/commands';
import type { ComposerModel, ComposerPermissionMode } from './composer-options';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ComposerSubmitPayload {
  message: string;
  permissionMode: ComposerPermissionMode;
  permissionSource?: PermissionModeSelectionSource;
  providerId: string;
  model: ComposerModel;
}

export interface ComposerProps {
  status?: ComposerStatus;
  initialValue?: string;
  providers?: ProviderPublicStatus[];
  seedTextKey?: string | null;
  seedText?: string | null;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachFiles?: () => void;
  getCommandSuggestions?: (request: { draft_input: string }) => CommandSuggestionResult | Promise<CommandSuggestionResult>;
}
