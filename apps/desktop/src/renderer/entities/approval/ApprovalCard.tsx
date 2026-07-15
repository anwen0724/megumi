import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ApprovalResolvePayload } from '@megumi/desktop/main/ipc/schemas';
import type { ApprovalRequest } from './store';
import { Badge, Button, Panel } from '../../shared/ui';

type ApprovalResolveScope = ApprovalResolvePayload['scope'];

export interface ApprovalCardResolvePayload {
  approvalRequestId: string;
  decision: 'approved' | 'denied';
  scope: ApprovalResolveScope;
  reason?: string;
}

interface ApprovalCardProps {
  request: ApprovalRequest;
  onResolve: (payload: ApprovalCardResolvePayload) => void;
}

const approvalScopes: ApprovalResolveScope[] = ['once', 'session'];

export function ApprovalCard({ request, onResolve }: ApprovalCardProps) {
  const { t } = useTranslation('chat');
  const [scope, setScope] = useState<ApprovalResolveScope>(resolveInitialScope(request.requestedScope));
  const displayToolName = request.modelVisibleName ?? request.toolName ?? 'tool';

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
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{displayToolName}</h3>
            <Badge variant="approval">{t('approvals.needed')}</Badge>
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{request.summary}</p>
          <p className="mt-2 truncate rounded-md bg-[var(--color-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
            {request.preview.action}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${request.approvalRequestId}-scope`}>
              {t('approvals.scope')}
            </label>
            <select
              id={`${request.approvalRequestId}-scope`}
              aria-label={t('approvals.scope')}
              value={scope}
              onChange={(event) => setScope(event.target.value as ApprovalResolveScope)}
              className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
            >
              {approvalScopes.map((option) => (
                <option key={option} value={option}>
                  {t(`approvals.${option}`)}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" onClick={() => resolve('approved')} aria-label={t('approvals.approve', { name: displayToolName })}>
              {t('approvals.approveAction')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => resolve('denied')} aria-label={t('approvals.deny', { name: displayToolName })}>
              {t('approvals.denyAction')}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function resolveInitialScope(scope: string): ApprovalResolveScope {
  return scope === 'session' ? 'session' : 'once';
}
