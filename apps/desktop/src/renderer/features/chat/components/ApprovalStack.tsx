import { ApprovalCard, type ApprovalCardResolvePayload } from '../../../entities/approval';
import type { ApprovalRequest } from '../../../entities/approval/store';
import { RecoverableErrorBoundary } from '../../../shared/ui';
import { useTranslation } from 'react-i18next';

interface ApprovalStackProps {
  requests: ApprovalRequest[];
  onResolve: (payload: ApprovalCardResolvePayload) => void;
}

export function ApprovalStack({ requests, onResolve }: ApprovalStackProps) {
  const { t } = useTranslation('chat');
  if (requests.length === 0) return null;

  return (
    <section
      aria-label={t('approvals.blockingControls')}
      aria-live="polite"
      aria-atomic="true"
      className="space-y-2"
    >
      {requests.map((request) => (
        <RecoverableErrorBoundary
          key={request.approvalRequestId}
          title={t('approvals.displayFailed')}
          resetKey={`${request.approvalRequestId}:${request.status}:${request.resolvedAt ?? ''}`}
        >
          <ApprovalCard
            request={request}
            onResolve={onResolve}
          />
        </RecoverableErrorBoundary>
      ))}
    </section>
  );
}
