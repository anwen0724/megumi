/* Presents one Content checkpoint and opens its body only after explicit user action. */
import { FileCode2, FileQuestion, LockKeyhole } from 'lucide-react';
import type {
  ObservabilityContentCheckpointUiDto,
  ObservabilityGetContentResult,
} from '@megumi/product-host/host';
import { Button } from '../../shared/ui';

interface TraceContentViewerProps {
  readonly checkpoint: ObservabilityContentCheckpointUiDto;
  readonly result?: ObservabilityGetContentResult | 'loading';
  readonly labels: {
    readonly view: string;
    readonly loading: string;
    readonly binary: string;
    readonly unavailable: string;
  };
  readonly onRead: () => void;
}

export function TraceContentViewer({ checkpoint, result, labels, onRead }: TraceContentViewerProps) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <ContentIcon mode={checkpoint.mode} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs font-semibold text-[var(--color-text)]">
              {checkpoint.kind}
            </span>
            <span className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[0.65rem] text-[var(--color-text-muted)]">
              #{checkpoint.sequence} · {checkpoint.mode}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[0.68rem] text-[var(--color-text-muted)]">
            {checkpoint.mediaType ?? checkpoint.reason ?? '—'}
            {checkpoint.byteLength === undefined ? '' : ` · ${checkpoint.byteLength} B`}
          </div>
          {checkpoint.contentId ? (
            <div className="mt-0.5 break-all font-mono text-[0.62rem] text-[var(--color-text-muted)]">
              sha256:{checkpoint.contentId}
            </div>
          ) : null}
        </div>
        {(checkpoint.mode === 'inline' || checkpoint.mode === 'stored') && !result ? (
          <Button size="sm" variant="secondary" onClick={onRead}>{labels.view}</Button>
        ) : null}
        {result === 'loading' ? (
          <span className="text-xs text-[var(--color-text-muted)]">{labels.loading}</span>
        ) : null}
      </div>
      {result && result !== 'loading' ? <ContentResult result={result} labels={labels} /> : null}
    </div>
  );
}

function ContentResult({
  result,
  labels,
}: {
  readonly result: ObservabilityGetContentResult;
  readonly labels: TraceContentViewerProps['labels'];
}) {
  if (result.status !== 'available') {
    const reason = result.status === 'failed' ? result.message
      : result.status === 'not_found' ? labels.unavailable : result.reason;
    return (
      <div className="border-t border-[var(--color-border)] px-3 py-3 text-xs text-[var(--color-text-muted)]">
        {reason}
      </div>
    );
  }
  if (result.content.encoding === 'binary') {
    return (
      <div className="border-t border-[var(--color-border)] px-3 py-3 text-xs text-[var(--color-text-muted)]">
        {labels.binary} · {result.content.mediaType} · {result.content.byteLength} B
      </div>
    );
  }
  const value = result.content.encoding === 'json' ? result.content.json : result.content.text;
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]/60 px-3 py-3 font-mono text-xs leading-5 text-[var(--color-text)]">
      {value}
    </pre>
  );
}

function ContentIcon({ mode }: { readonly mode: ObservabilityContentCheckpointUiDto['mode'] }) {
  if (mode === 'redacted') return <LockKeyhole size={15} className="text-[var(--color-text-muted)]" />;
  if (mode === 'unavailable') return <FileQuestion size={15} className="text-[var(--color-warning)]" />;
  return <FileCode2 size={15} className="text-[var(--color-accent)]" />;
}
