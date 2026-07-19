/* Places approval cards in the composer overlay while consuming canonical Tool Activity facts. */
import type { ToolActivityItem } from '@megumi/product/runtime-timeline';
import { useTranslation } from 'react-i18next';
import {
  ApprovalCard,
  type ToolApprovalResolvePayload,
  type ToolApprovalResolveResult,
} from '../../../entities/approval';
import { RecoverableErrorBoundary } from '../../../shared/ui';

interface ApprovalStackProps {
  requests: ToolActivityItem[];
  onResolve: (payload: ToolApprovalResolvePayload) => Promise<ToolApprovalResolveResult>;
}

export function ApprovalStack({ requests, onResolve }: ApprovalStackProps) {
  const { t } = useTranslation('chat');
  if (requests.length === 0) return null;

  return (
    <section
      data-testid="approval-stack"
      aria-label={t('approvals.blockingControls')}
      aria-live="polite"
      aria-atomic="true"
      className="space-y-2"
    >
      {requests.map((request) => (
        <RecoverableErrorBoundary
          key={request.approval?.approvalRequestId ?? request.toolCallId}
          title={t('approvals.displayFailed')}
          resetKey={`${request.approval?.approvalRequestId ?? request.toolCallId}:${request.status}`}
        >
          <ApprovalCard request={request} onResolve={onResolve} />
        </RecoverableErrorBoundary>
      ))}
    </section>
  );
}
