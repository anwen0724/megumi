/* Presents one captured Content checkpoint as readable, explicitly expandable evidence. */
import { useState } from 'react';
import {
  Check,
  Copy,
  FileCode2,
  FileQuestion,
  LoaderCircle,
  LockKeyhole,
} from 'lucide-react';
import type {
  ObservabilityContentCheckpointUiDto,
  ObservabilityGetContentResult,
} from '@megumi/product-host/host';
import { Button, cx } from '../../shared/ui';

interface TraceContentViewerProps {
  readonly checkpoint: ObservabilityContentCheckpointUiDto;
  readonly displayName: string;
  readonly result?: ObservabilityGetContentResult | 'loading';
  readonly highlighted?: boolean;
  readonly labels: {
    readonly view: string;
    readonly collapse: string;
    readonly loading: string;
    readonly binary: string;
    readonly unavailable: string;
    readonly checksum: string;
    readonly byteUnit: string;
    readonly formatted: string;
    readonly original: string;
    readonly copy: string;
    readonly copied: string;
    readonly technicalDetails: string;
    readonly recordSequence: string;
  };
  readonly onRead: () => void;
}

export function TraceContentViewer({
  checkpoint,
  displayName,
  result,
  highlighted = false,
  labels,
  onRead,
}: TraceContentViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'formatted' | 'original'>('formatted');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const availableText = result && result !== 'loading' && result.status === 'available'
    && result.content.encoding !== 'binary'
    ? result.content.encoding === 'json' ? result.content.json : result.content.text
    : undefined;

  function toggleExpanded() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!result) onRead();
  }

  async function copyContent() {
    if (!availableText) return;
    try {
      await navigator.clipboard.writeText(availableText);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  const readableMode = checkpoint.mode === 'inline' || checkpoint.mode === 'stored';
  return (
    <article
      id={`trace-content-${checkpoint.sequence}`}
      className={cx(
        'scroll-mt-6 rounded-xl border bg-[var(--color-surface)] transition-[border-color,box-shadow] duration-200',
        highlighted
          ? 'border-[var(--color-warning)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-warning)_14%,transparent)]'
          : 'border-[var(--color-border)]',
      )}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="rounded-lg bg-[var(--color-accent-soft)] p-2">
          <ContentIcon mode={checkpoint.mode} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-text)]">{displayName}</span>
            {checkpoint.issues?.some((issue) => issue.kind === 'unavailable') ? (
              <span className="rounded-full bg-[var(--color-warning)]/10 px-2 py-0.5 text-[0.64rem] font-medium text-[var(--color-warning)]">
                {checkpoint.issues.filter((issue) => issue.kind === 'unavailable').length}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.66rem] text-[var(--color-text-muted)]">
            <span className="font-mono">{checkpoint.kind}</span>
            <span aria-hidden="true">·</span>
            <span>{checkpoint.byteLength === undefined ? '—' : `${checkpoint.byteLength} ${labels.byteUnit}`}</span>
            <span aria-hidden="true">·</span>
            <span>{labels.recordSequence}</span>
          </div>
        </div>
        {readableMode ? (
          <Button
            size="sm"
            variant={expanded ? 'ghost' : 'secondary'}
            aria-expanded={expanded}
            onClick={toggleExpanded}
          >
            {result === 'loading' ? <LoaderCircle size={13} className="animate-spin" /> : null}
            {expanded ? labels.collapse : labels.view}
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-[var(--color-border)]">
          {availableText ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 px-3 py-2">
              {result && result !== 'loading'
                && result.status === 'available'
                && result.content.encoding === 'json' ? (
                <div className="inline-flex rounded-lg bg-[var(--color-surface-muted)] p-0.5">
                  <ContentModeButton
                    active={viewMode === 'formatted'}
                    label={labels.formatted}
                    onClick={() => setViewMode('formatted')}
                  />
                  <ContentModeButton
                    active={viewMode === 'original'}
                    label={labels.original}
                    onClick={() => setViewMode('original')}
                  />
                </div>
              ) : <span />}
              <Button size="sm" variant="ghost" onClick={() => void copyContent()}>
                {copyState === 'copied' ? <Check size={13} /> : <Copy size={13} />}
                {copyState === 'copied' ? labels.copied : labels.copy}
              </Button>
            </div>
          ) : null}
          {result && result !== 'loading' ? (
            <ContentResult result={result} labels={labels} viewMode={viewMode} />
          ) : (
            <div className="flex items-center gap-2 px-4 py-5 text-xs text-[var(--color-text-muted)]">
              <LoaderCircle size={14} className="animate-spin" />{labels.loading}
            </div>
          )}
          <details className="border-t border-[var(--color-border)] px-3.5 py-2.5 text-[0.66rem] text-[var(--color-text-muted)]">
            <summary className="cursor-pointer select-none font-medium hover:text-[var(--color-text)]">
              {labels.technicalDetails}
            </summary>
            <div className="mt-2 space-y-1 break-all font-mono">
              <div>{checkpoint.mode} · {checkpoint.mediaType ?? checkpoint.reason ?? '—'}</div>
              {checkpoint.contentId ? <div>{labels.checksum}: {checkpoint.contentId}</div> : null}
            </div>
          </details>
        </div>
      ) : null}
    </article>
  );
}

function ContentModeButton({
  active,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'rounded-md px-2.5 py-1 text-[0.66rem] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.97]',
        active
          ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
      )}
    >
      {label}
    </button>
  );
}

function ContentResult({
  result,
  labels,
  viewMode,
}: {
  readonly result: ObservabilityGetContentResult;
  readonly labels: TraceContentViewerProps['labels'];
  readonly viewMode: 'formatted' | 'original';
}) {
  if (result.status !== 'available') {
    const reason = result.status === 'failed' ? result.message
      : result.status === 'not_found' ? labels.unavailable : result.reason;
    return <div className="px-4 py-4 text-xs text-[var(--color-text-muted)]">{reason}</div>;
  }
  if (result.content.encoding === 'binary') {
    return (
      <div className="px-4 py-4 text-xs text-[var(--color-text-muted)]">
        {labels.binary} · {result.content.mediaType} · {result.content.byteLength} {labels.byteUnit}
      </div>
    );
  }
  const value = result.content.encoding === 'json'
    ? viewMode === 'formatted' ? formatJson(result.content.json) : result.content.json
    : result.content.text;
  return (
    <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words bg-[var(--color-surface-muted)]/25 px-4 py-4 font-mono text-xs leading-5 text-[var(--color-text)]">
      {value}
    </pre>
  );
}

function formatJson(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

function ContentIcon({ mode }: { readonly mode: ObservabilityContentCheckpointUiDto['mode'] }) {
  if (mode === 'redacted') return <LockKeyhole size={15} className="text-[var(--color-text-muted)]" />;
  if (mode === 'unavailable') return <FileQuestion size={15} className="text-[var(--color-warning)]" />;
  return <FileCode2 size={15} className="text-[var(--color-accent)]" />;
}
