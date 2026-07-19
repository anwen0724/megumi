import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleDot, CircleSlash, Clock3, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
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
import { rendererI18n } from '../../../shared/i18n';
import { Button, cx } from '../../../shared/ui';
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
  return rendererI18n.t(`chat:processing.status.${block.status}`);
}

function defaultProcessExpanded(status: ProcessDisclosureBlock['status']): boolean {
  return status === 'running' || status === 'failed' || status === 'cancelled' || status === 'incomplete';
}

function toolTarget(item: ToolActivityItem): string {
  return item.inputSummary ?? item.displayName ?? item.toolName;
}

function toolLabel(item: ToolActivityItem): string {
  const target = toolTarget(item);
  const action = toolAction(item.toolName);
  if (action && (item.status === 'running' || item.status === 'succeeded' || item.status === 'failed' || item.status === 'denied')) {
    return rendererI18n.t(`chat:processing.tool.actions.${action}.${item.status}`, { target });
  }
  return rendererI18n.t(`chat:processing.tool.${item.status}`, { target });
}

function toolAction(toolName: string): 'listDirectory' | 'readFile' | 'glob' | 'searchText' | 'editFile' | 'writeFile' | 'runCommand' | undefined {
  if (toolName === 'list_directory') return 'listDirectory';
  if (toolName === 'read_file') return 'readFile';
  if (toolName === 'glob') return 'glob';
  if (toolName === 'search_text') return 'searchText';
  if (toolName === 'edit_file') return 'editFile';
  if (toolName === 'write_file') return 'writeFile';
  if (toolName === 'run_command') return 'runCommand';
  return undefined;
}

function ItemIcon({ item }: { item: ProcessDisclosureItem }) {
  if (item.kind === 'tool_activity' && item.status === 'failed') {
    return <XCircle size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-danger)]" />;
  }
  if (item.kind === 'tool_activity' && item.status === 'denied') {
    return <CircleSlash size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-text-muted)]" />;
  }
  if (item.kind === 'tool_activity' && item.status === 'awaiting_approval') {
    return <Clock3 size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-warning)]" />;
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
  if (item.kind === 'tool_activity' && (item.status === 'running' || item.status === 'queued')) {
    return <CircleDot size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-accent)]" />;
  }
  return <CheckCircle2 size={14} aria-hidden="true" className="mt-1 shrink-0 text-[var(--color-success)]" />;
}

function ThinkingItemView({ item }: { item: ThinkingItem }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(true);
  const label = t(`processing.thinking.${item.status}`);

  useEffect(() => {
    setExpanded(true);
  }, [item.itemId]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t(expanded ? 'processing.collapse' : 'processing.expand', {
          item: t('processing.thinkingItem'),
        })}
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

export type ToolApprovalResolvePayload =
  | { approvalRequestId: string; decision: 'approved'; optionId: string }
  | { approvalRequestId: string; decision: 'denied' };

export type ToolApprovalResolveResult = { status: 'accepted' } | { status: 'failed'; message: string };

function ToolActivityItemView({
  item,
  onApprovalResolve,
}: {
  item: ToolActivityItem;
  onApprovalResolve?: (payload: ToolApprovalResolvePayload) => Promise<ToolApprovalResolveResult>;
}) {
  const { t } = useTranslation('chat');
  const [selectedOptionId, setSelectedOptionId] = useState(item.approval?.defaultOptionId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string>();

  useEffect(() => {
    setSelectedOptionId(item.approval?.defaultOptionId ?? '');
    setSubmitting(false);
    setSubmissionError(undefined);
  }, [item.approval?.approvalRequestId, item.approval?.defaultOptionId]);

  async function resolve(decision: 'approved' | 'denied') {
    if (!item.approval || !onApprovalResolve || submitting) return;
    setSubmitting(true);
    setSubmissionError(undefined);
    const payload: ToolApprovalResolvePayload = decision === 'approved'
      ? { approvalRequestId: item.approval.approvalRequestId, decision, optionId: selectedOptionId }
      : { approvalRequestId: item.approval.approvalRequestId, decision };
    const result = await onApprovalResolve(payload);
    if (result.status === 'failed') {
      setSubmissionError(result.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-w-0 items-start gap-2" data-testid={`tool-activity-${item.toolCallId}`}>
      <ItemIcon item={item} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[var(--color-text)] [overflow-wrap:anywhere]">{toolLabel(item)}</span>
        {item.resultSummary && item.status !== 'succeeded' ? <span className="block break-words text-xs text-[var(--color-text-muted)]">{item.resultSummary}</span> : null}
        {item.error ? <span className="block break-words text-xs text-[var(--color-danger)]">{item.error.message}</span> : null}
        {item.status === 'awaiting_approval' && item.approval ? (
          <span className="mt-2 block rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            {item.approval.summary ? <span className="mb-2 block text-xs text-[var(--color-text-muted)]">{item.approval.summary}</span> : null}
            <span className="block space-y-2">
              {item.approval.options.map((option) => (
                <label key={option.optionId} className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="radio"
                    name={`approval-${item.approval?.approvalRequestId}`}
                    value={option.optionId}
                    checked={selectedOptionId === option.optionId}
                    disabled={submitting}
                    onChange={() => setSelectedOptionId(option.optionId)}
                  />
                  <span><strong>{option.label}</strong><span className="ml-1 text-[var(--color-text-muted)]">{option.description}</span></span>
                </label>
              ))}
            </span>
            <span className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="primary" disabled={submitting || !selectedOptionId} onClick={() => { void resolve('approved'); }}>
                {submitting ? t('approvals.submitting') : t('approvals.approveAction')}
              </Button>
              <Button size="sm" variant="secondary" disabled={submitting} onClick={() => { void resolve('denied'); }}>
                {t('approvals.denyAction')}
              </Button>
            </span>
            {submissionError ? <span className="mt-2 block text-xs text-[var(--color-danger)]">{submissionError}</span> : null}
          </span>
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
  const { t } = useTranslation('chat');
  return (
    <div className="flex min-w-0 items-start gap-2 text-[var(--color-text-muted)]">
      <ItemIcon item={item} />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.reason ?? t('processing.cancelledDefault')}</span>
    </div>
  );
}

function CompactionActivityItemView({ item }: { item: CompactionActivityItem }) {
  const { t } = useTranslation('chat');
  return (
    <div className="flex min-w-0 items-start gap-2 text-[var(--color-text-muted)]">
      <ItemIcon item={item} />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{t(`compaction.${item.status}`)}</span>
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

function ProcessItemView({ item, onApprovalResolve }: { item: ProcessDisclosureItem; onApprovalResolve?: ProcessDisclosureBlockViewProps['onApprovalResolve'] }) {
  if (item.kind === 'thinking') return <ThinkingItemView item={item} />;
  if (item.kind === 'assistant_text') return <PreludeTextItemView item={item} />;
  if (item.kind === 'tool_activity') return <ToolActivityItemView item={item} onApprovalResolve={onApprovalResolve} />;
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
  onApprovalResolve?: (payload: ToolApprovalResolvePayload) => Promise<ToolApprovalResolveResult>;
}

export function ProcessDisclosureBlockView({ block, onApprovalResolve }: ProcessDisclosureBlockViewProps) {
  const { t } = useTranslation('chat');
  const defaultExpanded = useMemo(() => defaultProcessExpanded(block.status), [block.status]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [block.blockId, defaultExpanded]);

  const duration = formatDuration(block.startedAt, block.endedAt);

  return (
    <section aria-label={t('processing.processLabel')} className="min-w-0 space-y-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t(expanded ? 'processing.collapse' : 'processing.expand', {
          item: t('processing.processDisclosure'),
        })}
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
            block.items.map((item) => <ProcessItemView key={item.itemId} item={item} onApprovalResolve={onApprovalResolve} />)
          ) : (
            <p className="text-[var(--color-text-muted)]">
              {t(block.status === 'running' ? 'processing.waitingFirst' : 'processing.noRecords')}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
