import { useLayoutEffect, useRef } from 'react';
import type {
  ChatGetContextUsageUiResult,
  ChatImageInputCapabilitiesUiResult,
  ProviderPublicStatusUiDto,
} from '@megumi/product/host-interface';
import type { CommandSuggestionResult } from '@megumi/product/host-interface';
import type { ToolActivityItem } from '@megumi/product/runtime-timeline';
import type { ToolApprovalResolvePayload, ToolApprovalResolveResult } from '../../../entities/approval';
import { ApprovalStack } from '../components/ApprovalStack';
import { BranchDraftStack, type ComposerBranchDraftView } from '../components/BranchDraftStack';
import { ComposerSurface } from '../components/ComposerSurface';
import type { ChatComposerDraft } from '../../../entities/chat-ui/store';
import type {
  ComposerDraftAttachment,
  ComposerDraftDocument,
  ComposerDraftImage,
  ComposerStatus,
  ComposerSubmitPayload,
} from '../components/composer-types';
import { useComposerController } from '../hooks/use-composer-controller';
import { ComposerOverlayLayer } from './ComposerOverlayLayer';

const COMPOSER_DOCK_BOTTOM_PADDING = 12;

interface ComposerDockProps {
  status: ComposerStatus;
  branchDraft: ComposerBranchDraftView | null;
  approvalRequests?: ToolActivityItem[];
  onApprovalResolve?: (payload: ToolApprovalResolvePayload) => Promise<ToolApprovalResolveResult>;
  providers?: ProviderPublicStatusUiDto[];
  contextUsage?: ChatGetContextUsageUiResult;
  imageInputCapabilities?: ChatImageInputCapabilitiesUiResult;
  initialValue?: string;
  initialAttachments?: ComposerDraftAttachment[];
  onSubmit: (payload: ComposerSubmitPayload) => boolean | void | Promise<boolean | void>;
  onStop: () => void;
  onHeightChange?: (height: number) => void;
  getCommandSuggestions?: (request: { draft_input: string }) => CommandSuggestionResult | Promise<CommandSuggestionResult>;
  onSelectImages?: () => Promise<ComposerDraftImage[]>;
  onSelectDocuments?: () => Promise<ComposerDraftDocument[]>;
  onPasteImage?: () => Promise<ComposerDraftImage[]>;
  onDraftChange?: (draft: ChatComposerDraft) => void;
}

export function ComposerDock({
  status,
  branchDraft,
  approvalRequests = [],
  onApprovalResolve,
  providers,
  contextUsage,
  imageInputCapabilities,
  initialValue,
  initialAttachments,
  onSubmit,
  onStop,
  onHeightChange,
  getCommandSuggestions,
  onSelectImages,
  onSelectDocuments,
  onPasteImage,
  onDraftChange,
}: ComposerDockProps) {
  const composerSurfaceRef = useRef<HTMLFormElement | null>(null);
  const { composerSurfaceProps } = useComposerController({
    status,
    providers,
    contextUsage,
    imageInputCapabilities,
    initialValue,
    initialAttachments,
    seedTextKey: null,
    seedText: null,
    onSubmit,
    onStop,
    onSelectImages,
    onSelectDocuments,
    onPasteImage,
    onDraftChange,
    onChooseContext: () => undefined,
    getCommandSuggestions,
  });
  const hasOverlayContent = Boolean(branchDraft) || approvalRequests.length > 0;

  useLayoutEffect(() => {
    const element = composerSurfaceRef.current;
    if (!element || !onHeightChange) return undefined;

    const publishHeight = () => {
      onHeightChange(Math.ceil(element.getBoundingClientRect().height) + COMPOSER_DOCK_BOTTOM_PADDING);
    };

    publishHeight();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => publishHeight());
    observer.observe(element);

    return () => observer.disconnect();
  }, [onHeightChange]);

  return (
    <div
      data-testid="composer-dock"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-transparent pb-3"
    >
      <div
        data-testid="composer-dock-column"
        className="pointer-events-auto relative mx-auto w-[calc(100%-3rem)] max-w-[var(--chat-composer-width)]"
      >
        {hasOverlayContent ? (
          <ComposerOverlayLayer>
            {approvalRequests.length > 0 && onApprovalResolve ? (
              <ApprovalStack requests={approvalRequests} onResolve={onApprovalResolve} />
            ) : null}
            <BranchDraftStack branchDraft={branchDraft} />
          </ComposerOverlayLayer>
        ) : null}
        <ComposerSurface ref={composerSurfaceRef} {...composerSurfaceProps} />
      </div>
    </div>
  );
}
