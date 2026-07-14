// Defines the public Composer payload shape consumed by chat timeline orchestration.
type PermissionModeSelectionSource = 'user' | 'settings' | 'runtime' | string;
import type {
  ChatGetContextUsageUiResult,
  ChatImageInputCapabilitiesUiResult,
  ProviderPublicStatusUiDto,
} from '@megumi/product/host-interface';
import type { CommandSuggestionResult } from '@megumi/product/host-interface';
import type { ComposerModel, ComposerPermissionMode } from './composer-options';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export type ComposerDraftImage = {
  draftAttachmentId: string;
  name: string;
  declaredMimeType?: string;
  referenceId: string;
  previewDataUrl: string;
};

export interface ComposerSubmitPayload {
  message: string;
  permissionMode: ComposerPermissionMode;
  permissionSource?: PermissionModeSelectionSource;
  providerId: string;
  model: ComposerModel;
  attachments?: ComposerDraftImage[];
}

export interface ComposerProps {
  status?: ComposerStatus;
  initialValue?: string;
  providers?: ProviderPublicStatusUiDto[];
  contextUsage?: ChatGetContextUsageUiResult;
  imageInputCapabilities?: ChatImageInputCapabilitiesUiResult;
  seedTextKey?: string | null;
  seedText?: string | null;
  onSubmit: (payload: ComposerSubmitPayload) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  onChooseContext?: () => void;
  onSelectImages?: () => Promise<ComposerDraftImage[]>;
  getCommandSuggestions?: (request: { draft_input: string }) => CommandSuggestionResult | Promise<CommandSuggestionResult>;
}
