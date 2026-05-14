import { ShieldCheck } from 'lucide-react';
import type { ApprovalRequest } from '../../features/approvals/store';
import { Badge, Button, Panel } from '../../shared/ui';

interface ApprovalCardProps {
  request: ApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
  onViewDetails?: () => void;
}

function formatArguments(args: Record<string, unknown>): string {
  const preferred = args.command ?? args.path ?? args.url;
  if (typeof preferred === 'string' && preferred.trim().length > 0) {
    return preferred;
  }

  return JSON.stringify(args);
}

export function ApprovalCard({ request, onApprove, onDeny, onViewDetails }: ApprovalCardProps) {
  const details = formatArguments(request.arguments);

  return (
    <Panel className="p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-approval-soft)] text-[var(--color-approval)]">
          <ShieldCheck size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{request.toolName}</h3>
            <Badge variant="approval">Approval needed</Badge>
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{request.displayText}</p>
          <p className="mt-2 truncate rounded-md bg-[var(--color-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
            {details}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={onApprove} aria-label={`Approve ${request.toolName}`}>
              Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={onDeny} aria-label={`Deny ${request.toolName}`}>
              Deny
            </Button>
            {onViewDetails ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={onViewDetails}
                aria-label={`View ${request.toolName} details`}
              >
                Details
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}
