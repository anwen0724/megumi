import { ApprovalCard, type ApprovalCardResolvePayload } from '../../../entities/approval';
import type { ApprovalRequest } from '@megumi/renderer-contracts/tool';

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
        <ApprovalCard
          key={request.approvalRequestId}
          request={request}
          onResolve={onResolve}
        />
      ))}
    </section>
  );
}

