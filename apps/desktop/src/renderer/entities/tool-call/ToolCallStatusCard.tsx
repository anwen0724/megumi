import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import type { ToolExecution, ToolExecutionStatus } from '@megumi/shared/tool-contracts';
import { Badge, Panel, cx } from '../../shared/ui';

interface ToolCallStatusCardProps {
  toolCall: ToolExecution;
}

const statusConfig: Record<ToolExecutionStatus, {
  label: string;
  badge: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'approval';
  icon: typeof Clock;
}> = {
  pending_approval: {
    label: 'Waiting for approval',
    badge: 'approval',
    icon: ShieldCheck,
  },
  running: {
    label: 'Running',
    badge: 'accent',
    icon: Loader2,
  },
  completed: {
    label: 'Completed',
    badge: 'success',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    badge: 'danger',
    icon: AlertCircle,
  },
  denied: {
    label: 'Denied',
    badge: 'danger',
    icon: XCircle,
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'warning',
    icon: XCircle,
  },
};

function iconTone(status: ToolExecutionStatus): string {
  if (status === 'failed' || status === 'denied' || status === 'cancelled') {
    return 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]';
  }
  if (status === 'completed') {
    return 'bg-[var(--color-success-soft)] text-[var(--color-success)]';
  }
  if (status === 'pending_approval') {
    return 'bg-[var(--color-approval-soft)] text-[var(--color-approval)]';
  }
  return 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]';
}

export function ToolCallStatusCard({ toolCall }: ToolCallStatusCardProps) {
  const config = statusConfig[toolCall.status];
  const StatusIcon = config.icon;
  const spinning = toolCall.status === 'running';

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div
          className={cx(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            iconTone(toolCall.status),
          )}
        >
          <StatusIcon size={16} aria-hidden="true" className={spinning ? 'animate-spin' : ''} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{toolCall.toolName}</h3>
            <Badge variant={config.badge}>{config.label}</Badge>
          </div>

          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{toolCall.inputPreview.summary}</p>

          {toolCall.inputPreview.targets.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {toolCall.inputPreview.targets.map((target) => (
                <Badge key={`${target.kind}-${target.label}`} variant="neutral">
                  {target.label}
                </Badge>
              ))}
            </div>
          ) : null}

          {toolCall.policyDecision ? (
            <p className="mt-2 rounded-md bg-[var(--color-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
              Policy: {toolCall.policyDecision.decision} - {toolCall.policyDecision.reason}
            </p>
          ) : null}

          {toolCall.resultPreview ? (
            <p className="mt-2 rounded-md bg-[var(--color-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-text)]">
              {toolCall.resultPreview}
            </p>
          ) : null}

          {toolCall.error ? (
            <p className="mt-2 rounded-md bg-[var(--color-danger-soft)] px-2 py-1.5 text-xs text-[var(--color-danger)]">
              {toolCall.error.message}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
