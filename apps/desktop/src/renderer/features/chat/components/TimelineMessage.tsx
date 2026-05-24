import { memo } from 'react';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/shared/timeline-message-blocks';
import type { TimelineMessageData } from '../../../entities/chat/types';
import { cx } from '../../../shared/ui';
import { TimelineMessageBlocks } from './TimelineMessageBlocks';

type LegacyTimelineMessage = Pick<TimelineMessageData, 'role' | 'content' | 'timestamp'>;

interface TimelineMessageProps {
  message: CanonicalTimelineMessage | LegacyTimelineMessage;
  streaming?: boolean;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isCanonicalMessage(message: CanonicalTimelineMessage | LegacyTimelineMessage): message is CanonicalTimelineMessage {
  return 'messageId' in message && 'blocks' in message;
}

function messageCreatedAt(message: CanonicalTimelineMessage | LegacyTimelineMessage): string {
  return isCanonicalMessage(message) ? message.createdAt : message.timestamp;
}

function LegacyMessageBody({ message }: { message: LegacyTimelineMessage }) {
  return <p className="whitespace-pre-wrap">{message.content}</p>;
}

function TimelineMessageComponent({ message, streaming = false }: TimelineMessageProps) {
  const role = message.role;
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';
  const isSystem = role === 'system';

  return (
    <article
      role="article"
      aria-label={isUser ? 'User message' : isAssistant ? 'Megumi message' : isSystem ? 'System message' : `${role} message`}
      className={cx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
        isSystem ? 'justify-center' : undefined,
      )}
    >
      <div
        className={cx(
          'max-w-2xl text-sm leading-7',
          isUser
            ? 'rounded-lg bg-[var(--color-accent-soft)] px-4 py-3 text-right text-[var(--color-text)]'
            : 'text-left text-[var(--color-text)]',
          isSystem ? 'max-w-md text-center text-[var(--color-text-muted)]' : undefined,
        )}
      >
        <div
          className={cx(
            'mb-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]',
            isUser ? 'justify-end' : 'justify-start',
            isSystem ? 'justify-center' : undefined,
          )}
        >
          <span>{isUser ? 'You' : isAssistant ? 'Megumi' : role}</span>
          {streaming && !isCanonicalMessage(message) ? <span>Streaming</span> : null}
          <span>{formatTime(messageCreatedAt(message))}</span>
        </div>

        {isCanonicalMessage(message) ? <TimelineMessageBlocks message={message} /> : <LegacyMessageBody message={message} />}
      </div>
    </article>
  );
}

export const TimelineMessage = memo(TimelineMessageComponent);
