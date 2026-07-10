import type {
  AnswerTextBlock,
  BranchSeparatorBlock,
  TimelineMessage as CanonicalTimelineMessage,
  UserTimelineBlock,
} from '@megumi/product/runtime-timeline';
import { TimelineMarkdown } from './TimelineMarkdown';
import { ProcessDisclosureBlockView } from './ProcessDisclosureBlockView';
import { RecoverableErrorBoundary } from '../../../shared/ui';

function UserBlockView({ block }: { block: UserTimelineBlock }) {
  if (block.kind === 'user_attachment') {
    return <span>{block.name}</span>;
  }

  return <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{block.text}</p>;
}

function AnswerTextBlockView({ block }: { block: AnswerTextBlock }) {
  return (
    <div className="min-w-0 space-y-2 text-sm leading-7 text-[var(--color-text)]">
      <TimelineMarkdown text={block.text} />
      {block.status === 'failed' ? (
        <p className="text-xs text-[var(--color-text-muted)]">（回复中断）</p>
      ) : null}
      {block.status === 'cancelled_partial' ? (
        <p className="text-xs text-[var(--color-text-muted)]">（已取消，以上为部分回复）</p>
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
}

export function TimelineMessageBlocks({ message }: TimelineMessageBlocksProps) {
  if (message.role === 'user') {
    return (
      <>
        {message.blocks.map((block) => (
          <RecoverableErrorBoundary
            key={block.blockId}
            title="Message block could not be displayed"
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
        title="Message separator could not be displayed"
        resetKey={message.messageId}
      >
        <BranchSeparatorBlockView block={message.blocks[0]} />
      </RecoverableErrorBoundary>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {message.blocks.map((block) => {
        if (block.kind === 'process_disclosure') {
          return (
            <RecoverableErrorBoundary
              key={block.blockId}
              title="Process details could not be displayed"
              resetKey={blockResetKey(block)}
            >
              <ProcessDisclosureBlockView block={block} />
            </RecoverableErrorBoundary>
          );
        }

        if (block.kind === 'answer_text') {
          return (
            <RecoverableErrorBoundary
              key={block.blockId}
              title="Assistant response could not be displayed"
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
