import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleDot, XCircle } from 'lucide-react';
import { cx } from '../../../shared/ui';
import type { ProcessingDisclosureEntry, ProcessingDisclosureModel } from '../processing-disclosure';

interface ProcessingDisclosureProps {
  model: ProcessingDisclosureModel;
}

function entryToneClassName(tone: ProcessingDisclosureEntry['tone']): string {
  if (tone === 'success') return 'text-[var(--color-success)]';
  if (tone === 'warning') return 'text-[var(--color-warning)]';
  if (tone === 'danger') return 'text-[var(--color-danger)]';
  return 'text-[var(--color-text-muted)]';
}

function isTerminal(status: ProcessingDisclosureModel['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function ProcessingDisclosure({ model }: ProcessingDisclosureProps) {
  const [expanded, setExpanded] = useState(() => !isTerminal(model.status));

  useEffect(() => {
    setExpanded(!isTerminal(model.status));
  }, [model.runId, model.status]);

  const terminal = isTerminal(model.status);
  const toggleLabel = `${expanded ? 'Collapse' : 'Expand'} processing disclosure`;

  return (
    <section aria-label="Agent processing disclosure" className="space-y-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={toggleLabel}
        onClick={() => setExpanded((value) => !value)}
        className={cx(
          'flex w-full items-center gap-2 border-b border-[var(--color-border)] px-1 py-2 text-left',
          'text-sm text-[var(--color-text-muted)] transition hover:text-[var(--color-text)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
        )}
      >
        <ChevronRight
          size={15}
          aria-hidden="true"
          className={cx('shrink-0 transition-transform', expanded ? 'rotate-90' : undefined)}
        />
        <span className="font-medium text-[var(--color-text-muted)]">{model.statusLabel}</span>
        <span>{model.durationLabel}</span>
      </button>

      {expanded ? (
        <div className="space-y-3 pl-6 text-sm">
          {model.currentAction ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                当前动作
              </p>
              <div className="flex items-center gap-2 text-[var(--color-text)]">
                <CircleDot size={14} aria-hidden="true" className="text-[var(--color-accent)]" />
                <span>{model.currentAction}</span>
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              已完成
            </p>
            {model.completedEntries.length > 0 ? (
              <ul className="space-y-2">
                {model.completedEntries.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2">
                    {entry.tone === 'danger' ? (
                      <XCircle size={14} aria-hidden="true" className={cx('mt-1 shrink-0', entryToneClassName(entry.tone))} />
                    ) : (
                      <CheckCircle2
                        size={14}
                        aria-hidden="true"
                        className={cx('mt-1 shrink-0', entryToneClassName(entry.tone))}
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block text-[var(--color-text)]">{entry.label}</span>
                      {entry.detail ? (
                        <span className="block text-xs text-[var(--color-text-muted)]">{entry.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[var(--color-text-muted)]">
                {terminal ? '没有可展示的工作记录。' : '正在等待第一条运行记录。'}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
