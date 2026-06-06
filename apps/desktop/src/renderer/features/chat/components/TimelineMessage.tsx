import { memo, type ReactNode } from 'react';
import { GitBranch, RotateCcw } from 'lucide-react';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline-message-blocks';
import { IconButton } from '../../../shared/ui';
import { TimelineMessageBlocks } from './TimelineMessageBlocks';

interface TimelineMessageProps {
  message: CanonicalTimelineMessage;
  showUserActions?: boolean;
  onBranchFromMessage?: (message: CanonicalTimelineMessage) => void;
  onRerunMessage?: (message: CanonicalTimelineMessage) => void;
  afterContent?: ReactNode;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function TimelineMessageComponent({
  message,
  showUserActions = false,
  onBranchFromMessage,
  onRerunMessage,
  afterContent,
}: TimelineMessageProps) {
  const role = message.role;
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';
  const canBranch = isUser && showUserActions;

  if (message.role === 'separator') {
    return (
      <div
        role="separator"
        aria-label={message.blocks[0].label}
        className="flex items-center gap-3 py-2 text-xs text-[var(--color-text-muted)]"
      >
        <span className="h-px flex-1 bg-[var(--color-border)]" />
        <span>{message.blocks[0].label}</span>
        <span className="h-px flex-1 bg-[var(--color-border)]" />
      </div>
    );
  }

  if (isUser) {
    return (
      <article
        role="article"
        aria-label="User message"
        className="flex w-full justify-end animate-[megumi-message-in_160ms_ease-out]"
      >
        <div className="relative group flex max-w-3xl flex-col items-end text-right text-sm leading-7 text-[var(--color-text)]">
          {canBranch ? (
            <div className="absolute -left-24 top-0 flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <IconButton
                label="Branch from here"
                size="sm"
                variant="ghost"
                onClick={() => onBranchFromMessage?.(message)}
              >
                <GitBranch size={14} aria-hidden="true" />
              </IconButton>
              <IconButton
                label="Rerun"
                size="sm"
                variant="ghost"
                onClick={() => onRerunMessage?.(message)}
              >
                <RotateCcw size={14} aria-hidden="true" />
              </IconButton>
            </div>
          ) : null}

          <div
            data-testid="user-message-card"
            className="max-w-full rounded-md bg-[var(--color-accent-soft)] px-3 py-2 text-left shadow-sm"
          >
            <TimelineMessageBlocks message={message} />
          </div>
          <time
            dateTime={message.createdAt}
            className="mt-1 block text-xs leading-5 text-[var(--color-text-muted)]"
          >
            {formatTime(message.createdAt)}
          </time>
          {afterContent}
        </div>
      </article>
    );
  }

  return (
    <article
      role="article"
      aria-label={isAssistant ? 'Megumi message' : `${role} message`}
      className="flex w-full animate-[megumi-message-in_160ms_ease-out] justify-start"
    >
      <div className="max-w-3xl text-sm leading-7 w-full text-left text-[var(--color-text)]">
        <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)] justify-start">
          <span>{isAssistant ? 'Megumi' : role}</span>
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        </div>

        <TimelineMessageBlocks message={message} />
        {afterContent}
      </div>
    </article>
  );
}

export const TimelineMessage = memo(TimelineMessageComponent);
