/* Renders only the selected Session's current turn and delegates operations to existing Product contracts. */
import { ChevronDown, RotateCcw, Square } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApprovalCard } from '../../../entities/approval/ApprovalCard';
import type { ToolApprovalResolvePayload, ToolApprovalResolveResult } from '../../../entities/approval';
import type { CurrentInteraction } from '../current-interaction';

export function CurrentInteractionView(props: {
  readonly selectedSessionId: string | null;
  readonly interaction: CurrentInteraction | null;
  readonly activeExecutionId?: string;
  readonly onApprovalResolve: (payload: ToolApprovalResolvePayload) => Promise<ToolApprovalResolveResult>;
  readonly onCancel: () => Promise<boolean>;
  readonly onRetry: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation('character');
  const [expanded, setExpanded] = useState(true);
  const { interaction } = props;

  return (
    <section className="app-no-drag overflow-hidden rounded-2xl border border-white/30 bg-slate-950/58 text-white shadow-xl backdrop-blur-xl">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-white/75"
        aria-expanded={expanded}
        aria-label={t(expanded ? 'interaction.collapse' : 'interaction.expand')}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{t('interaction.title')}</span>
        <ChevronDown size={15} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {expanded ? (
        <div className="max-h-[38vh] space-y-2 overflow-y-auto border-t border-white/10 px-3 py-2 text-sm">
          {!props.selectedSessionId ? <p className="text-white/65">{t('interaction.noSession')}</p> : null}
          {props.selectedSessionId && !interaction ? <p className="text-white/65">{t('interaction.noActivity')}</p> : null}
          {interaction?.userText ? <Fact label={t('interaction.input')} text={interaction.userText} /> : null}
          {interaction?.replyText ? <Fact label={t('interaction.reply')} text={interaction.replyText} /> : null}
          {interaction?.activeTool ? (
            <Fact
              label={t('interaction.tool')}
              text={interaction.activeTool.inputSummary ?? interaction.activeTool.displayName ?? interaction.activeTool.toolName}
            />
          ) : null}
          {interaction?.approval ? (
            <div className="text-slate-950">
              <ApprovalCard request={interaction.approval} onResolve={props.onApprovalResolve} />
            </div>
          ) : null}
          {interaction?.error ? <p className="rounded-lg bg-rose-400/15 px-2 py-1.5 text-xs text-rose-100">{interaction.error}</p> : null}
          {interaction ? (
            <div className="flex gap-2 pt-1">
              {props.activeExecutionId ? (
                <button type="button" className="flex items-center gap-1.5 rounded-lg bg-rose-300/90 px-2.5 py-1.5 text-xs font-semibold text-slate-950" onClick={() => { void props.onCancel(); }}>
                  <Square size={12} />{t('interaction.cancel')}
                </button>
              ) : null}
              {(interaction.status === 'failed' || interaction.status === 'cancelled') && interaction.userText ? (
                <button type="button" className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs" onClick={() => { void props.onRetry(interaction.userText!); }}>
                  <RotateCcw size={12} />{t('interaction.retry')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Fact({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/8 px-2.5 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">{label}</span>
      <p className="mt-1 line-clamp-5 whitespace-pre-wrap break-words text-xs leading-5 text-white/90">{text}</p>
    </div>
  );
}
