import { memo } from 'react';
import type { TimelineMessageData } from '../../../entities/chat/types';
import { cx } from '../../../shared/ui';

interface TimelineMessageProps {
  message: Pick<TimelineMessageData, 'role' | 'content' | 'timestamp'>;
  streaming?: boolean;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function TimelineMessageComponent({ message, streaming = false }: TimelineMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <article
      className={cx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
        message.role === 'system' ? 'justify-center' : undefined,
      )}
    >
      <div
        className={cx(
          'max-w-2xl text-sm leading-7',
          isUser
            ? 'rounded-lg bg-[var(--color-accent-soft)] px-4 py-3 text-right text-[var(--color-text)]'
            : 'text-left text-[var(--color-text)]',
          message.role === 'system'
            ? 'max-w-md text-center text-[var(--color-text-muted)]'
            : undefined,
        )}
      >
        <div
          className={cx(
            'mb-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]',
            isUser ? 'justify-end' : 'justify-start',
            message.role === 'system' ? 'justify-center' : undefined,
          )}
        >
          <span>{isUser ? 'You' : isAssistant ? 'Megumi' : message.role}</span>
          {streaming ? <span>Streaming</span> : null}
          <span>{formatTime(message.timestamp)}</span>
        </div>
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </article>
  );
}

export const TimelineMessage = memo(TimelineMessageComponent);
