import { ApprovalCard, type ApprovalCardResolvePayload } from '../../../entities/approval';
import type { ApprovalRequest } from '../../../entities/approval/store';
import { RecoverableErrorBoundary } from '../../../shared/ui';

interface ApprovalStackProps {
  requests: ApprovalRequest[];
  onResolve: (payload: ApprovalCardResolvePayload) => void;
}

export function ApprovalStack({ requests, onResolve }: ApprovalStackProps) {
  if (requests.length === 0) return null;

  return (
    <section
      aria-label="Blocking approval controls"
      aria-live="polite"
      aria-atomic="true"
      className="space-y-2"
    >
      {requests.map((request) => (
        <RecoverableErrorBoundary
          key={request.approvalRequestId}
          title="Approval could not be displayed"
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
