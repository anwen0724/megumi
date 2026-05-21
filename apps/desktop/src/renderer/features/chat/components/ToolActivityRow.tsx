import { CheckCircle2, ChevronRight } from 'lucide-react';
import type { CompletedToolActivity } from '../../../entities/chat/store';
import { Badge, cx } from '../../../shared/ui';

interface ToolActivityRowProps {
  activity: CompletedToolActivity;
  expanded: boolean;
  onToggle: () => void;
}

export function ToolActivityRow({ activity, expanded, onToggle }: ToolActivityRowProps) {
  const preferredArg = activity.args.query ?? activity.args.command ?? activity.args.path ?? activity.args.url;
  const detail = typeof preferredArg === 'string' && preferredArg.trim().length > 0
    ? preferredArg
    : JSON.stringify(activity.args);

  return (
    <section className="space-y-2" aria-label={`Completed tool activity ${activity.name}`}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} completed tool activity ${activity.name}`}
        onClick={onToggle}
        className={cx(
          'flex w-full items-center gap-3 rounded-lg border border-[var(--color-border)]',
          'bg-[var(--color-surface)] px-3 py-2 text-left text-sm shadow-sm',
          'transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
        )}
      >
        <ChevronRight
          size={16}
          aria-hidden="true"
          className={cx(
            'shrink-0 text-[var(--color-text-muted)] transition-transform',
            expanded ? 'rotate-90' : undefined,
          )}
        />
        <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 text-[var(--color-success)]" />
        <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">
          Megumi checked workspace context
        </span>
        <Badge variant="success">Completed</Badge>
        <span className="shrink-0 text-xs text-[var(--color-text-muted)]">{activity.duration}</span>
      </button>

      {expanded ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{activity.name}</h3>
            <Badge variant="success">Completed</Badge>
            <span className="text-xs text-[var(--color-text-muted)]">{activity.duration}</span>
          </div>
          <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">{detail}</p>
          <p className="mt-2 rounded-md bg-[var(--color-surface-muted)] px-2 py-1.5 text-xs text-[var(--color-text)]">
            {activity.result}
          </p>
        </div>
      ) : null}
    </section>
  );
}
