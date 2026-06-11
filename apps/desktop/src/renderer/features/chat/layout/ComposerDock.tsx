import { useLayoutEffect, useRef } from 'react';
import type { ApprovalRequest } from '@megumi/shared/tool';
import type { RecoverableRunSummary } from '@megumi/shared/recovery';
import type { ApprovalCardResolvePayload } from '../../../entities/approval';
import { ApprovalStack } from '../components/ApprovalStack';
import { BranchDraftStack, type ComposerBranchDraftView } from '../components/BranchDraftStack';
import { CommandSuggestionPanel } from '../components/CommandSuggestionPanel';
import { ComposerSurface } from '../components/ComposerSurface';
import type { ComposerStatus, ComposerSubmitPayload } from '../components/composer-types';
import { RecoverableActionStack } from '../components/RecoverableActionStack';
import { useComposerController } from '../hooks/use-composer-controller';
import { ComposerOverlayLayer } from './ComposerOverlayLayer';

const COMPOSER_DOCK_BOTTOM_PADDING = 12;

interface ComposerDockProps {
  status: ComposerStatus;
  branchDraft: ComposerBranchDraftView | null;
  pendingApprovals: ApprovalRequest[];
  recoverableRuns: RecoverableRunSummary[];
  pendingRecoverableRunIds: Set<string>;
  onApprovalResolve: (payload: ApprovalCardResolvePayload) => void;
  onRetry: (run: RecoverableRunSummary) => void;
  onRerun: (run: RecoverableRunSummary) => void;
  onMarkCancelled: (run: RecoverableRunSummary) => void;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStop: () => void;
  onHeightChange?: (height: number) => void;
}

export function ComposerDock({
  status,
  branchDraft,
  pendingApprovals,
  recoverableRuns,
  pendingRecoverableRunIds,
  onApprovalResolve,
  onRetry,
  onRerun,
  onMarkCancelled,
  onSubmit,
  onStop,
  onHeightChange,
}: ComposerDockProps) {
  const composerSurfaceRef = useRef<HTMLFormElement | null>(null);
  const {
    commandSuggestionPanelProps,
    composerSurfaceProps,
  } = useComposerController({
    status,
    seedTextKey: branchDraft?.key ?? null,
    seedText: branchDraft?.seedText ?? null,
    onSubmit,
    onStop,
    onAttachFiles: () => undefined,
    onChooseContext: () => undefined,
  });
  const hasOverlayContent =
    pendingApprovals.length > 0 ||
    recoverableRuns.length > 0 ||
    Boolean(branchDraft) ||
    Boolean(commandSuggestionPanelProps);

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
            <ApprovalStack requests={pendingApprovals} onResolve={onApprovalResolve} />
            <RecoverableActionStack
              runs={recoverableRuns}
              pendingRunIds={pendingRecoverableRunIds}
              onRetry={onRetry}
              onRerun={onRerun}
              onMarkCancelled={onMarkCancelled}
            />
            <BranchDraftStack branchDraft={branchDraft} />
            {commandSuggestionPanelProps ? (
              <CommandSuggestionPanel {...commandSuggestionPanelProps} />
            ) : null}
          </ComposerOverlayLayer>
        ) : null}
        <ComposerSurface ref={composerSurfaceRef} {...composerSurfaceProps} />
      </div>
    </div>
  );
}

