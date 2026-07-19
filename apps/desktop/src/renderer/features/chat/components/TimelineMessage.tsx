import { memo, type ReactNode } from 'react';
import { Archive, Check, Copy, GitBranch, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TimelineMessage as CanonicalTimelineMessage } from '@megumi/product/runtime-timeline';
import { IconButton, RecoverableErrorBoundary } from '../../../shared/ui';
import { TimelineMessageBlocks } from './TimelineMessageBlocks';
import { formatTime as formatLocalizedTime } from '../../../shared/i18n';

interface TimelineMessageProps {
  message: CanonicalTimelineMessage;
  showBranchAction?: boolean;
  onBranchFromMessage?: (message: CanonicalTimelineMessage) => void;
  afterContent?: ReactNode;
}

function TimelineMessageComponent({
  message,
  showBranchAction = false,
  onBranchFromMessage,
  afterContent,
}: TimelineMessageProps) {
  const { t } = useTranslation('chat');
  const role = message.role;
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';
  const hasActionableReply = isAssistant && message.blocks.some((block) => (
    block.kind === 'answer_text'
    && ['completed', 'failed', 'cancelled'].includes(block.status)
    && typeof block.text === 'string'
    && Boolean(block.text.trim())
  ));
  const canBranch = hasActionableReply && showBranchAction;
  const canShowAssistantActions = hasActionableReply;

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

  if (message.role === 'activity') {
    const activity = message.blocks[0];
    const Icon = activity.status === 'running'
      ? LoaderCircle
      : activity.status === 'failed'
        ? TriangleAlert
        : activity.status === 'completed'
          ? Check
          : Archive;
    return (
      <div
        role="status"
        aria-label={activity.label}
        className="flex items-center gap-2 py-1 text-sm text-[var(--color-text-muted)]"
      >
        <Icon size={15} aria-hidden="true" className={activity.status === 'running' ? 'animate-spin' : undefined} />
        <span>{activity.label}</span>
      </div>
    );
  }

  if (isUser) {
    return (
      <article
        role="article"
        aria-label={t('timeline.userMessage')}
        className="flex w-full justify-end animate-[megumi-message-in_160ms_ease-out]"
      >
        <div className="relative group flex min-w-0 max-w-3xl flex-col items-end text-right text-sm leading-7 text-[var(--color-text)]">
          <div
            data-testid="user-message-card"
            className="max-w-full min-w-0 rounded-md bg-[var(--color-accent-soft)] px-3 py-2 text-left shadow-sm"
          >
            <TimelineMessageBlocks message={message} />
          </div>
          <time
            dateTime={message.createdAt}
            className="mt-1 block text-xs leading-5 text-[var(--color-text-muted)]"
          >
            {formatLocalizedTime(message.createdAt) ?? ''}
          </time>
          {afterContent ? (
            <RecoverableErrorBoundary title={t('timeline.detailsFailed')} resetKey={message.messageId}>
              {afterContent}
            </RecoverableErrorBoundary>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article
      role="article"
      aria-label={isAssistant ? t('timeline.assistantMessage') : t('timeline.roleMessage', { role })}
      className="flex w-full animate-[megumi-message-in_160ms_ease-out] justify-start"
    >
      <div className="min-w-0 max-w-3xl text-sm leading-7 w-full text-left text-[var(--color-text)]">
        <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)] justify-start">
          <span>{isAssistant ? 'Megumi' : role}</span>
          <time dateTime={message.createdAt}>{formatLocalizedTime(message.createdAt) ?? ''}</time>
        </div>

        <TimelineMessageBlocks message={message} />
        {afterContent ? (
          <RecoverableErrorBoundary title={t('timeline.detailsFailed')} resetKey={message.messageId}>
            {afterContent}
          </RecoverableErrorBoundary>
        ) : null}
        {canShowAssistantActions ? (
          <div
            data-testid="assistant-message-actions"
            className="mt-3 flex items-center gap-1 text-[var(--color-text-muted)]"
          >
            <IconButton
              label={t('timeline.copyReply')}
              size="sm"
              variant="ghost"
              onClick={() => {
                void copyAssistantReply(message);
              }}
            >
              <Copy size={14} aria-hidden="true" />
            </IconButton>
            {canBranch ? (
              <IconButton
                label={t('timeline.branchReply')}
                size="sm"
                variant="ghost"
                onClick={() => onBranchFromMessage?.(message)}
              >
                <GitBranch size={14} aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const TimelineMessage = memo(TimelineMessageComponent);

function assistantReplyText(message: CanonicalTimelineMessage): string {
  if (message.role !== 'assistant') return '';
  return message.blocks
    .filter((block) => block.kind === 'answer_text')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function copyAssistantReply(message: CanonicalTimelineMessage): Promise<void> {
  const text = assistantReplyText(message);
  if (!text || !navigator.clipboard?.writeText) return;
  await navigator.clipboard.writeText(text);
}
