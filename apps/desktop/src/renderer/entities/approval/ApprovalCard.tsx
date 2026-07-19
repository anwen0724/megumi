/* Renders the original composer-overlay approval card from canonical Tool Activity facts. */
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolActivityItem } from '@megumi/product/runtime-timeline';
import { Badge, Button, Panel } from '../../shared/ui';
import type { ToolApprovalResolvePayload, ToolApprovalResolveResult } from './types';

interface ApprovalCardProps {
  request: ToolActivityItem;
  onResolve: (payload: ToolApprovalResolvePayload) => Promise<ToolApprovalResolveResult>;
}

export function ApprovalCard({ request, onResolve }: ApprovalCardProps) {
  const { t } = useTranslation('chat');
  const approval = request.approval;
  const [optionId, setOptionId] = useState(approval?.defaultOptionId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string>();
  const displayToolName = request.displayName ?? request.toolName;

  useEffect(() => {
    setOptionId(approval?.defaultOptionId ?? '');
    setSubmitting(false);
    setSubmissionError(undefined);
  }, [approval?.approvalRequestId, approval?.defaultOptionId]);

  if (!approval) return null;
  const approvalFacts = approval;

  async function resolve(decision: 'approved' | 'denied') {
    if (submitting || (decision === 'approved' && !optionId)) return;
    setSubmitting(true);
    setSubmissionError(undefined);
    const payload: ToolApprovalResolvePayload = decision === 'approved'
      ? { approvalRequestId: approvalFacts.approvalRequestId, decision, optionId }
      : { approvalRequestId: approvalFacts.approvalRequestId, decision };
    try {
      const result = await onResolve(payload);
      if (result.status === 'failed') {
        setSubmissionError(result.message);
        setSubmitting(false);
      }
    } catch {
      setSubmissionError(t('notifications.approvalFailed.message'));
      setSubmitting(false);
    }
  }

  return (
    <Panel className="p-3" data-testid={`approval-card-${approval.approvalRequestId}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-approval-soft)] text-[var(--color-approval)]">
          <ShieldCheck size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{displayToolName}</h3>
            <Badge variant="approval">{t('approvals.needed')}</Badge>
          </div>
          {approval.summary ? <p className="mt-2 text-sm text-[var(--color-text-muted)]">{approval.summary}</p> : null}
          <p className="mt-2 truncate rounded-md bg-[var(--color-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
            {request.inputSummary ?? request.toolName}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${approval.approvalRequestId}-option`}>
              {t('approvals.scope')}
            </label>
            <select
              id={`${approval.approvalRequestId}-option`}
              aria-label={t('approvals.scope')}
              value={optionId}
              disabled={submitting}
              onChange={(event) => setOptionId(event.target.value)}
              className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
            >
              {approval.options.map((option) => (
                <option key={option.optionId} value={option.optionId}>{option.label}</option>
              ))}
            </select>
            <Button size="sm" variant="primary" disabled={submitting || !optionId} onClick={() => { void resolve('approved'); }} aria-label={t('approvals.approve', { name: displayToolName })}>
              {submitting ? t('approvals.submitting') : t('approvals.approveAction')}
            </Button>
            <Button size="sm" variant="secondary" disabled={submitting} onClick={() => { void resolve('denied'); }} aria-label={t('approvals.deny', { name: displayToolName })}>
              {t('approvals.denyAction')}
            </Button>
          </div>
          {submissionError ? <p className="mt-2 text-xs text-[var(--color-danger)]">{submissionError}</p> : null}
        </div>
      </div>
    </Panel>
  );
}
