import type {
  AnswerTextBlock,
  BranchSeparatorBlock,
  TimelineMessage as CanonicalTimelineMessage,
  UserTimelineBlock,
} from '@megumi/product/runtime-timeline';
import { TimelineMarkdown } from './TimelineMarkdown';
import { ProcessDisclosureBlockView, type ToolApprovalResolvePayload, type ToolApprovalResolveResult } from './ProcessDisclosureBlockView';
import { RecoverableErrorBoundary } from '../../../shared/ui';
import { useEffect, useState } from 'react';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { useTranslation } from 'react-i18next';

function UserBlockView({ block }: { block: UserTimelineBlock }) {
  if (block.kind === 'user_attachment') {
    return <TimelineImageAttachment attachmentId={block.attachmentId} name={block.name} />;
  }

  return <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{block.text}</p>;
}

function TimelineImageAttachment({ attachmentId, name }: { attachmentId: string; name: string }) {
  const [dataUrl, setDataUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    const reader = window.megumi?.session?.imageInput?.readAttachment;
    if (!reader) return () => { active = false; };
    void reader(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.chat.attachmentImageRead, { attachmentId }),
    ).then((result) => {
      if (active && result.ok && result.data.status === 'ok') setDataUrl(result.data.dataUrl);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [attachmentId]);
  if (!dataUrl) return <span className="text-xs text-[var(--color-text-muted)]">{name}</span>;
  return <img src={dataUrl} alt={name} className="max-h-80 max-w-full rounded-xl border border-[var(--color-border)] object-contain" />;
}

function AnswerTextBlockView({ block }: { block: AnswerTextBlock }) {
  const { t } = useTranslation('chat');
  return (
    <div className="min-w-0 space-y-2 text-sm leading-7 text-[var(--color-text)]">
      <TimelineMarkdown text={block.text} />
      {block.status === 'failed' || block.status === 'interrupted' ? (
        <p className="text-xs text-[var(--color-text-muted)]">{t('timeline.responseInterrupted')}</p>
      ) : null}
      {block.status === 'cancelled' ? (
        <p className="text-xs text-[var(--color-text-muted)]">{t('timeline.responseCancelled')}</p>
      ) : null}
      {block.status === 'legacy_unknown' ? (
        <p className="text-xs text-[var(--color-text-muted)]">{t('timeline.responseLegacyUnknown')}</p>
      ) : null}
    </div>
  );
}

function BranchSeparatorBlockView({ block }: { block: BranchSeparatorBlock }) {
  return (
    <div className="border-y border-[var(--color-border)] py-2 text-center text-xs text-[var(--color-text-muted)]">
      {block.label}
    </div>
  );
}

function blockResetKey(block: { blockId: string; status?: unknown }): string {
  return `${block.blockId}:${String(block.status ?? '')}`;
}

interface TimelineMessageBlocksProps {
  message: CanonicalTimelineMessage;
  onApprovalResolve?: (payload: ToolApprovalResolvePayload) => Promise<ToolApprovalResolveResult>;
}

export function TimelineMessageBlocks({ message, onApprovalResolve }: TimelineMessageBlocksProps) {
  const { t } = useTranslation('chat');
  if (message.role === 'user') {
    return (
      <>
        {message.blocks.map((block) => (
          <RecoverableErrorBoundary
            key={block.blockId}
            title={t('timeline.blockFailed')}
            resetKey={block.blockId}
          >
            <UserBlockView block={block} />
          </RecoverableErrorBoundary>
        ))}
      </>
    );
  }

  if (message.role === 'separator') {
    return (
      <RecoverableErrorBoundary
        title={t('timeline.separatorFailed')}
        resetKey={message.messageId}
      >
        <BranchSeparatorBlockView block={message.blocks[0]} />
      </RecoverableErrorBoundary>
    );
  }

  if (message.role === 'activity') {
    return null;
  }

  return (
    <div className="min-w-0 space-y-4">
      {message.blocks.map((block) => {
        if (block.kind === 'process_disclosure') {
          return (
            <RecoverableErrorBoundary
              key={block.blockId}
              title={t('timeline.processFailed')}
              resetKey={blockResetKey(block)}
            >
              <ProcessDisclosureBlockView block={block} onApprovalResolve={onApprovalResolve} />
            </RecoverableErrorBoundary>
          );
        }

        if (block.kind === 'answer_text') {
          return (
            <RecoverableErrorBoundary
              key={block.blockId}
              title={t('timeline.responseFailed')}
              resetKey={blockResetKey(block)}
            >
              <AnswerTextBlockView block={block} />
            </RecoverableErrorBoundary>
          );
        }

        const exhaustive: never = block;
        return exhaustive;
      })}
    </div>
  );
}
