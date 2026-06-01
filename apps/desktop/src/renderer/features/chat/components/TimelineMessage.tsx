import { memo, type ReactNode } from 'react';
import { GitBranch, RotateCcw } from 'lucide-react';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline-message-blocks';
import { cx, IconButton } from '../../../shared/ui';
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

  return (
    <article
      role="article"
      aria-label={isUser ? 'User message' : isAssistant ? 'Megumi message' : `${role} message`}
      className={cx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {canBranch ? (
        <div className="relative group flex justify-end">
          <div className="absolute -left-24 top-2 flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
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
          <div
            className={cx(
              'max-w-2xl text-sm leading-7',
              'rounded-lg bg-[var(--color-accent-soft)] px-4 py-3 text-right text-[var(--color-text)]',
            )}
          >
            <div className="mb-2 flex items-center justify-end gap-2 text-xs text-[var(--color-text-muted)]">
              <span>You</span>
              <span>{formatTime(message.createdAt)}</span>
            </div>

            <TimelineMessageBlocks message={message} />
            {afterContent}
          </div>
        </div>
      ) : (
      <div
        className={cx(
          'max-w-2xl text-sm leading-7',
          isUser
            ? 'rounded-lg bg-[var(--color-accent-soft)] px-4 py-3 text-right text-[var(--color-text)]'
            : 'text-left text-[var(--color-text)]',
        )}
      >
        <div
          className={cx(
            'mb-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]',
            isUser ? 'justify-end' : 'justify-start',
          )}
        >
          <span>{isUser ? 'You' : isAssistant ? 'Megumi' : role}</span>
          <span>{formatTime(message.createdAt)}</span>
        </div>

        <TimelineMessageBlocks message={message} />
        {afterContent}
      </div>
      )}
    </article>
  );
}

export const TimelineMessage = memo(TimelineMessageComponent);
