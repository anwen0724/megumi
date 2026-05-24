import { memo } from 'react';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline-message-blocks';
import { cx } from '../../../shared/ui';
import { TimelineMessageBlocks } from './TimelineMessageBlocks';

interface TimelineMessageProps {
  message: CanonicalTimelineMessage;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function TimelineMessageComponent({ message }: TimelineMessageProps) {
  const role = message.role;
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';

  return (
    <article
      role="article"
      aria-label={isUser ? 'User message' : isAssistant ? 'Megumi message' : `${role} message`}
      className={cx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
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
      </div>
    </article>
  );
}

export const TimelineMessage = memo(TimelineMessageComponent);
