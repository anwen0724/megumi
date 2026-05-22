import { memo } from 'react';
import type { TimelineMessageData } from '../../../entities/chat/types';
import { Badge, cx } from '../../../shared/ui';

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
          'max-w-2xl rounded-xl border px-4 py-3 text-sm leading-6',
          isUser
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]',
          message.role === 'system'
            ? 'max-w-md border-[var(--color-border)] bg-[var(--color-surface-muted)] text-center text-[var(--color-text-muted)]'
            : undefined,
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-xs opacity-80">
          <span>{isUser ? 'You' : isAssistant ? 'Megumi' : message.role}</span>
          {streaming ? <Badge variant="accent">Streaming</Badge> : null}
          <span>{formatTime(message.timestamp)}</span>
        </div>
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </article>
  );
}

export const TimelineMessage = memo(TimelineMessageComponent);
