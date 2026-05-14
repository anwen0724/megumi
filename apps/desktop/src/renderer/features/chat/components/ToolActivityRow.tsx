import { CheckCircle2, ChevronRight } from 'lucide-react';
import type { CompletedToolActivity, PendingToolCall } from '../../../entities/chat/store';
import { ToolCallStatusCard } from '../../../entities/tool-call';
import { Badge, cx } from '../../../shared/ui';

interface ToolActivityRowProps {
  activity: CompletedToolActivity;
  expanded: boolean;
  onToggle: () => void;
}

function toCompletedToolCall(activity: CompletedToolActivity): PendingToolCall {
  return {
    id: activity.id,
    name: activity.name,
    args: activity.args,
    status: 'completed',
    result: activity.result,
    duration: activity.duration,
  };
}

export function ToolActivityRow({ activity, expanded, onToggle }: ToolActivityRowProps) {
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

      {expanded ? <ToolCallStatusCard toolCall={toCompletedToolCall(activity)} /> : null}
    </section>
  );
}
