// Defines the public Composer payload shape consumed by chat timeline orchestration.
type PermissionModeSelectionSource = 'user' | 'settings' | 'runtime' | string;
import type {
  ChatGetContextUsageUiResult,
  ChatImageInputCapabilitiesUiResult,
  ProviderPublicStatusUiDto,
} from '@megumi/product/host-interface';
import type { CommandSuggestionResult } from '@megumi/product/host-interface';
import type { ComposerModel, ComposerPermissionMode } from './composer-options';
import type {
  ChatComposerDraft,
  ChatComposerDraftAttachment,
  ChatComposerDraftDocument,
  ChatComposerDraftImage,
} from '../../../entities/chat-ui/store';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export type ComposerDraftImage = ChatComposerDraftImage;
export type ComposerDraftDocument = ChatComposerDraftDocument;
export type ComposerDraftAttachment = ChatComposerDraftAttachment;

export interface ComposerSubmitPayload {
  message: string;
  skillSelection?: { type: 'skill'; name: string; skillPath: string };
  permissionMode: ComposerPermissionMode;
  permissionSource?: PermissionModeSelectionSource;
  providerId: string;
  model: ComposerModel;
  attachments?: ComposerDraftAttachment[];
}

export interface ComposerProps {
  status?: ComposerStatus;
  initialValue?: string;
  initialAttachments?: ComposerDraftAttachment[];
  providers?: ProviderPublicStatusUiDto[];
  contextUsage?: ChatGetContextUsageUiResult;
  imageInputCapabilities?: ChatImageInputCapabilitiesUiResult;
  seedTextKey?: string | null;
  seedText?: string | null;
  onSubmit: (payload: ComposerSubmitPayload) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  onChooseContext?: () => void;
  onSelectImages?: () => Promise<ComposerDraftImage[]>;
  onSelectDocuments?: () => Promise<ComposerDraftDocument[]>;
  onPasteImage?: () => Promise<ComposerDraftImage[]>;
  onDraftChange?: (draft: ChatComposerDraft) => void;
  getCommandSuggestions?: (request: { draft_input: string }) => CommandSuggestionResult | Promise<CommandSuggestionResult>;
}
