import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ApprovalRequest, ApprovalScope } from '@megumi/shared/tool';
import { Badge, Button, Panel } from '../../shared/ui';

export interface ApprovalCardResolvePayload {
  approvalRequestId: string;
  decision: 'approved' | 'denied';
  scope: ApprovalScope;
  reason?: string;
}

interface ApprovalCardProps {
  request: ApprovalRequest;
  onResolve: (payload: ApprovalCardResolvePayload) => void;
}

const approvalScopes: ApprovalScope[] = ['once', 'run', 'project', 'local'];

export function ApprovalCard({ request, onResolve }: ApprovalCardProps) {
  const [scope, setScope] = useState<ApprovalScope>(request.requestedScope);

  function resolve(decision: 'approved' | 'denied') {
    onResolve({
      approvalRequestId: request.approvalRequestId,
      decision,
      scope,
    });
  }

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
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{request.summary}</p>
          <p className="mt-2 truncate rounded-md bg-[var(--color-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
            {request.preview.action}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${request.approvalRequestId}-scope`}>
              Approval scope
            </label>
            <select
              id={`${request.approvalRequestId}-scope`}
              aria-label="Approval scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as ApprovalScope)}
              className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
            >
              {approvalScopes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" onClick={() => resolve('approved')} aria-label={`Approve ${request.toolName}`}>
              Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => resolve('denied')} aria-label={`Deny ${request.toolName}`}>
              Deny
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

