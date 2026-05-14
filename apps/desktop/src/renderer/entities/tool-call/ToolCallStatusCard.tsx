import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { PendingToolCall } from '../chat/store';
import { Badge, Panel, cx } from '../../shared/ui';

interface ToolCallStatusCardProps {
  toolCall: PendingToolCall;
}

const statusConfig = {
  executing: {
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
} as const;

function formatArgs(args: Record<string, unknown>): string {
  const preferred = args.path ?? args.command ?? args.query ?? args.url;
  if (typeof preferred === 'string' && preferred.trim().length > 0) {
    return preferred;
  }

  return JSON.stringify(args);
}

export function ToolCallStatusCard({ toolCall }: ToolCallStatusCardProps) {
  const config = statusConfig[toolCall.status];
  const StatusIcon = config.icon;

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div
          className={cx(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            toolCall.status === 'failed'
              ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
              : 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
          )}
        >
          <StatusIcon size={16} aria-hidden="true" className={toolCall.status === 'executing' ? 'animate-spin' : ''} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{toolCall.name}</h3>
            <Badge variant={config.badge}>{config.label}</Badge>
            {toolCall.duration ? (
              <span className="text-xs text-[var(--color-text-muted)]">{toolCall.duration}</span>
            ) : null}
          </div>

          <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">{formatArgs(toolCall.args)}</p>

          {toolCall.result ? (
            <p className="mt-2 rounded-md bg-[var(--color-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-text)]">
              {toolCall.result}
            </p>
          ) : null}

          {toolCall.error ? (
            <p className="mt-2 rounded-md bg-[var(--color-danger-soft)] px-2 py-1.5 text-xs text-[var(--color-danger)]">
              {toolCall.error}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
