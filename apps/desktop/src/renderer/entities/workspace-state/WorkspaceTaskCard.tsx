import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Badge, Panel, cx } from '../../shared/ui';
import type { WorkspaceTask } from './store';

interface WorkspaceTaskCardProps {
  task: WorkspaceTask;
}

const statusConfig = {
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
} as const;

export function WorkspaceTaskCard({ task }: WorkspaceTaskCardProps) {
  const config = statusConfig[task.status];
  const StatusIcon = config.icon;

  return (
    <Panel className="p-3">
      <div className="flex items-start gap-3">
        <div
          className={cx(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            task.status === 'failed'
              ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
              : 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
          )}
        >
          <StatusIcon size={16} aria-hidden="true" className={task.status === 'running' ? 'animate-spin' : ''} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{task.title}</h3>
            <Badge variant={config.badge}>{config.label}</Badge>
          </div>
          <p className="mt-2 text-sm leading-5 text-[var(--color-text-muted)]">{task.detail}</p>
        </div>
      </div>
    </Panel>
  );
}
