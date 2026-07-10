import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleDot, CircleSlash, Clock3, XCircle } from 'lucide-react';
import type {
  ApprovalActivityItem,
  AssistantTextItem,
  CancelledActivityItem,
  CompactionActivityItem,
  ErrorActivityItem,
  ProcessDisclosureBlock,
  ProcessDisclosureItem,
  RecoveryActivityItem,
  RetryActivityItem,
  ThinkingItem,
  ToolActivityItem,
} from '@megumi/product/runtime-timeline';
import { cx } from '../../../shared/ui';
import { TimelineMarkdown } from './TimelineMarkdown';

function formatDuration(start?: string, end?: string): string {
  if (!start) return '';
  const startedAt = new Date(start).getTime();
  const endedAt = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) return '';
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  return `${seconds}s`;
}

function processLabel(block: ProcessDisclosureBlock): string {
  if (block.status === 'running') return '正在处理';
  if (block.status === 'completed') return '已处理';
  if (block.status === 'failed') return '处理失败';
  return '已取消';
}

function defaultProcessExpanded(status: ProcessDisclosureBlock['status']): boolean {
  return status === 'running' || status === 'failed' || status === 'cancelled';
}

function toolTarget(item: ToolActivityItem): string {
  return item.inputSummary ?? item.displayName ?? item.toolName;
}

function toolLabel(item: ToolActivityItem): string {
  const target = toolTarget(item);
  const labels = toolActionLabels(item.toolName);
  if (item.status === 'running') return `${labels.running} ${target}`;
  if (item.status === 'succeeded') return `${labels.succeeded} ${target}`;
  if (item.status === 'failed') return `${labels.failed} ${target}`;
  return `${labels.denied} ${target}`;
}

function toolActionLabels(toolName: string): {
  running: string;
  succeeded: string;
  failed: string;
  denied: string;
} {
  if (toolName === 'list_directory') {
    return { running: '正在查看', succeeded: '已查看', failed: '查看失败', denied: '已拒绝查看' };
  }
  if (toolName === 'read_file') {
    return { running: '正在读取', succeeded: '已读取', failed: '读取失败', denied: '已拒绝读取' };
  }
  if (toolName === 'glob') {
    return { running: '正在查找', succeeded: '已查找', failed: '查找失败', denied: '已拒绝查找' };
  }
  if (toolName === 'search_text') {
    return { running: '正在搜索', succeeded: '已搜索', failed: '搜索失败', denied: '已拒绝搜索' };
  }
  if (toolName === 'edit_file') {
    return { running: '正在编辑', succeeded: '已编辑', failed: '编辑失败', denied: '已拒绝编辑' };
  }
  if (toolName === 'write_file') {
    return { running: '正在写入', succeeded: '已写入', failed: '写入失败', denied: '已拒绝写入' };
  }
  if (toolName === 'run_command') {
    return { running: '正在执行命令', succeeded: '已执行命令', failed: '命令执行失败', denied: '已拒绝执行命令' };
  }
  return { running: '正在执行', succeeded: '已完成', failed: '执行失败', denied: '已拒绝执行' };
}

function approvalLabel(item: ApprovalActivityItem): string {
  const subject = item.title;
  if (item.status === 'pending') return `等待审批：${subject}`;
  if (item.status === 'approved') return `已批准 ${subject}`;
  if (item.status === 'rejected') return `已拒绝 ${subject}`;
  if (item.status === 'expired') return `审批已过期 ${subject}`;
  return `审批已取消 ${subject}`;
}

function ItemIcon({ item }: { item: ProcessDisclosureItem }) {
  if (item.kind === 'tool_activity' && item.status === 'failed') {
    return <XCircle size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-danger)]" />;
  }
  if (item.kind === 'tool_activity' && item.status === 'denied') {
    return <CircleSlash size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-text-muted)]" />;
  }
  if (item.kind === 'approval_activity' && item.status === 'pending') {
    return <Clock3 size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-warning)]" />;
  }
  if (item.kind === 'approval_activity' && item.status === 'rejected') {
    return <XCircle size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-danger)]" />;
  }
  if (item.kind === 'approval_activity' && (item.status === 'expired' || item.status === 'cancelled')) {
    return <CircleSlash size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-text-muted)]" />;
  }
  if (item.kind === 'retry_activity' && (item.status === 'failed' || item.status === 'exhausted')) {
    return <XCircle size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-danger)]" />;
  }
  if (item.kind === 'retry_activity' && item.status === 'cancelled') {
    return <CircleSlash size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-text-muted)]" />;
  }
  if (item.kind === 'retry_activity' && item.status === 'started') {
    return <CircleDot size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-accent)]" />;
  }
  if (item.kind === 'recovery_activity' && item.status !== 'manual_retry_requested' && item.status !== 'manual_rerun_requested') {
    return <CircleSlash size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-text-muted)]" />;
  }
  if (item.kind === 'error_activity') {
    return <XCircle size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-danger)]" />;
  }
  if (item.kind === 'cancelled_activity') {
    return <CircleSlash size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-text-muted)]" />;
  }
  if (item.kind === 'tool_activity' && item.status === 'running') {
    return <CircleDot size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-accent)]" />;
  }
  return <CheckCircle2 size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-success)]" />;
}

function ThinkingItemView({ item }: { item: ThinkingItem }) {
  const defaultExpanded = item.status === 'streaming';
  const [expanded, setExpanded] = useState(defaultExpanded);
  const label = item.status === 'streaming' ? '正在思考' : '思考完成';

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [item.itemId, defaultExpanded]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} thinking item`}
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-2 text-left text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ChevronRight size={13} aria-hidden="true" className={cx('transition-transform', expanded ? 'rotate-90' : undefined)} />
        <span>{label}</span>
      </button>
      {expanded ? (
        <div className="mt-2 min-w-0 border-l-2 border-[var(--color-border)] pl-3 text-xs italic leading-6 text-[var(--color-text-muted)]">
          {item.format === 'markdown' ? (
            <TimelineMarkdown text={item.text} />
          ) : (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PreludeTextItemView({ item }: { item: AssistantTextItem }) {
  return (
    <div className="min-w-0 text-[var(--color-text)]">
      {item.format === 'markdown' ? (
        <TimelineMarkdown text={item.text} />
      ) : (
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</p>
      )}
    </div>
  );
}

function ToolActivityItemView({ item }: { item: ToolActivityItem }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <ItemIcon item={item} />
      <span className="min-w-0">
        <span className="block break-words text-[var(--color-text)] [overflow-wrap:anywhere]">{toolLabel(item)}</span>
      </span>
    </div>
  );
}

function ApprovalActivityItemView({ item }: { item: ApprovalActivityItem }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <ItemIcon item={item} />
      <span className="min-w-0">
        <span className="block break-words text-[var(--color-text)] [overflow-wrap:anywhere]">{approvalLabel(item)}</span>
        {item.description ? (
          <span className="block break-words text-xs text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{item.description}</span>
        ) : null}
      </span>
    </div>
  );
}

function ErrorActivityItemView({ item }: { item: ErrorActivityItem }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-[var(--color-danger)]">
      <ItemIcon item={item} />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.errorMessage}</span>
    </div>
  );
}

function CancelledActivityItemView({ item }: { item: CancelledActivityItem }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-[var(--color-text-muted)]">
      <ItemIcon item={item} />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.reason ?? '已取消本次运行。'}</span>
    </div>
  );
}

function CompactionActivityItemView({ item }: { item: CompactionActivityItem }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-[var(--color-text-muted)]">
      <ItemIcon item={item} />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.label}</span>
    </div>
  );
}

function RetryActivityItemView({ item }: { item: RetryActivityItem }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <ItemIcon item={item} />
      <span className="min-w-0">
        <span className="block break-words text-[var(--color-text)] [overflow-wrap:anywhere]">{item.label}</span>
        {item.reason ? (
          <span className="block break-words text-xs text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{item.reason}</span>
        ) : null}
      </span>
    </div>
  );
}

function RecoveryActivityItemView({ item }: { item: RecoveryActivityItem }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-[var(--color-text-muted)]">
      <ItemIcon item={item} />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.label}</span>
    </div>
  );
}

function ProcessItemView({ item }: { item: ProcessDisclosureItem }) {
  if (item.kind === 'thinking') return <ThinkingItemView item={item} />;
  if (item.kind === 'assistant_text') return <PreludeTextItemView item={item} />;
  if (item.kind === 'tool_activity') return <ToolActivityItemView item={item} />;
  if (item.kind === 'approval_activity') return <ApprovalActivityItemView item={item} />;
  if (item.kind === 'error_activity') return <ErrorActivityItemView item={item} />;
  if (item.kind === 'cancelled_activity') return <CancelledActivityItemView item={item} />;
  if (item.kind === 'compaction_activity') return <CompactionActivityItemView item={item} />;
  if (item.kind === 'retry_activity') return <RetryActivityItemView item={item} />;
  if (item.kind === 'recovery_activity') return <RecoveryActivityItemView item={item} />;

  const exhaustive: never = item;
  return exhaustive;
}

interface ProcessDisclosureBlockViewProps {
  block: ProcessDisclosureBlock;
}

export function ProcessDisclosureBlockView({ block }: ProcessDisclosureBlockViewProps) {
  const defaultExpanded = useMemo(() => defaultProcessExpanded(block.status), [block.status]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [block.blockId, defaultExpanded]);

  const duration = formatDuration(block.startedAt, block.endedAt);

  return (
    <section aria-label="Process disclosure" className="min-w-0 space-y-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} process disclosure`}
        onClick={() => setExpanded((value) => !value)}
        className={cx(
          'flex w-full items-center gap-2 border-b border-[var(--color-border)] px-1 py-2 text-left',
          'text-sm text-[var(--color-text-muted)] transition-[color,border-color] duration-150 hover:text-[var(--color-text)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
        )}
      >
        <ChevronRight size={15} aria-hidden="true" className={cx('shrink-0 transition-transform', expanded ? 'rotate-90' : undefined)} />
        <span className="font-medium">{processLabel(block)}</span>
        {duration ? <span>{duration}</span> : null}
      </button>

      {expanded ? (
        <div className="min-w-0 space-y-3 border-l border-[var(--color-border)] pl-5 text-sm">
          {block.items.length > 0 ? (
            block.items.map((item) => <ProcessItemView key={item.itemId} item={item} />)
          ) : (
            <p className="text-[var(--color-text-muted)]">
              {block.status === 'running' ? '正在等待第一条运行记录。' : '没有可展示的工作记录。'}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
