import type {
  AnswerTextBlock,
  BranchSeparatorBlock,
  TimelineMessage as CanonicalTimelineMessage,
  UserTimelineBlock,
} from '@megumi/shared/timeline-message-blocks';
import { TimelineMarkdown } from './TimelineMarkdown';
import { ProcessDisclosureBlockView } from './ProcessDisclosureBlockView';

function UserBlockView({ block }: { block: UserTimelineBlock }) {
  if (block.kind === 'user_attachment') {
    return <span>{block.name}</span>;
  }

  return <p className="whitespace-pre-wrap">{block.text}</p>;
}

function AnswerTextBlockView({ block }: { block: AnswerTextBlock }) {
  return (
    <div className="space-y-2 text-sm leading-7 text-[var(--color-text)]">
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

interface TimelineMessageBlocksProps {
  message: CanonicalTimelineMessage;
}

export function TimelineMessageBlocks({ message }: TimelineMessageBlocksProps) {
  if (message.role === 'user') {
    return (
      <>
        {message.blocks.map((block) => <UserBlockView key={block.blockId} block={block} />)}
      </>
    );
  }

  if (message.role === 'separator') {
    return <BranchSeparatorBlockView block={message.blocks[0]} />;
  }

  return (
    <div className="space-y-4">
      {message.blocks.map((block) => {
        if (block.kind === 'process_disclosure') {
          return <ProcessDisclosureBlockView key={block.blockId} block={block} />;
        }

        if (block.kind === 'answer_text') {
          return <AnswerTextBlockView key={block.blockId} block={block} />;
        }

        const exhaustive: never = block;
        return exhaustive;
      })}
    </div>
  );
}
