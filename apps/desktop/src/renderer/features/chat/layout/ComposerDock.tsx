import { useLayoutEffect, useRef } from 'react';
import type { ApprovalRequest } from '@megumi/shared/tool-contracts';
import type { RecoverableRunSummary } from '@megumi/shared/recovery-contracts';
import type { ApprovalCardResolvePayload } from '../../../entities/approval';
import { ApprovalStack } from '../components/ApprovalStack';
import { BranchDraftStack, type ComposerBranchDraftView } from '../components/BranchDraftStack';
import { Composer, type ComposerStatus, type ComposerSubmitPayload } from '../components/Composer';
import { RecoverableActionStack } from '../components/RecoverableActionStack';

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
  const dockRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = dockRef.current;
    if (!element || !onHeightChange) return undefined;

    const publishHeight = () => {
      onHeightChange(Math.ceil(element.getBoundingClientRect().height));
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
      ref={dockRef}
      data-testid="composer-dock"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-transparent px-6 pb-3"
    >
      <div data-testid="composer-dock-content" className="pointer-events-auto mx-auto w-full max-w-[var(--chat-column-width)]">
        <ApprovalStack requests={pendingApprovals} onResolve={onApprovalResolve} />
        <RecoverableActionStack
          runs={recoverableRuns}
          pendingRunIds={pendingRecoverableRunIds}
          onRetry={onRetry}
          onRerun={onRerun}
          onMarkCancelled={onMarkCancelled}
        />
        <BranchDraftStack branchDraft={branchDraft} />
        <Composer
          status={status}
          seedTextKey={branchDraft?.key ?? null}
          seedText={branchDraft?.seedText ?? null}
          onSubmit={onSubmit}
          onStop={onStop}
          onAttachFiles={() => undefined}
          onChooseContext={() => undefined}
        />
      </div>
    </div>
  );
}
