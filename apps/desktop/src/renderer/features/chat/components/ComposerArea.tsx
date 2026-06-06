import type { ApprovalCardResolvePayload } from '../../../entities/approval';
import type { RecoverableRunSummary } from '@megumi/shared/recovery-contracts';
import { Composer, type ComposerStatus, type ComposerSubmitPayload, type ComposerBranchDraftView } from './Composer';
import { ApprovalStack } from './ApprovalStack';
import { RecoverableActionStack } from './RecoverableActionStack';
import type { ApprovalRequest } from '@megumi/shared/tool-contracts';

interface ComposerAreaProps {
  status: ComposerStatus;
  branchDraft: ComposerBranchDraftView | null;
  pendingApprovals: ApprovalRequest[];
  unmatchedRecoverableRuns: RecoverableRunSummary[];
  pendingRecoverableRunIds: Set<string>;
  onApprovalResolve: (payload: ApprovalCardResolvePayload) => void;
  onRetry: (run: RecoverableRunSummary) => void;
  onRerun: (run: RecoverableRunSummary) => void;
  onMarkCancelled: (run: RecoverableRunSummary) => void;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStop: () => void;
  onHeightChange?: (height: number) => void;
}

export function ComposerArea({
  status,
  branchDraft,
  pendingApprovals,
  unmatchedRecoverableRuns,
  pendingRecoverableRunIds,
  onApprovalResolve,
  onRetry,
  onRerun,
  onMarkCancelled,
  onSubmit,
  onStop,
}: ComposerAreaProps) {
  return (
    <div data-testid="composer-area" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-transparent px-6 pb-6">
      <div data-testid="composer-area-column" className="pointer-events-auto mx-auto w-full max-w-3xl">
        <ApprovalStack requests={pendingApprovals} onResolve={onApprovalResolve} />
        <RecoverableActionStack
          runs={unmatchedRecoverableRuns}
          pendingRunIds={pendingRecoverableRunIds}
          onRetry={onRetry}
          onRerun={onRerun}
          onMarkCancelled={onMarkCancelled}
        />
        <Composer
          status={status}
          branchDraft={branchDraft}
          onSubmit={onSubmit}
          onStop={onStop}
          onAttachFiles={() => undefined}
          onChooseContext={() => undefined}
        />
      </div>
    </div>
  );
}
