import { FormEvent, KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  AtSign,
  Bot,
  Brain,
  Clock3,
  LoaderCircle,
  Paperclip,
  SendHorizontal,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { Badge, Button, IconButton, cx } from '../../../shared/ui';
import {
  COMPOSER_MODE_OPTIONS,
  COMPOSER_MODEL_OPTIONS,
  type ComposerMode,
  type ComposerModel,
} from './composer-options';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ComposerSubmitPayload {
  message: string;
  mode: ComposerMode;
  model: ComposerModel;
}

interface ComposerProps {
  status?: ComposerStatus;
  initialValue?: string;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachFiles?: () => void;
  onShowApproval?: () => void;
}

const statusConfig = {
  idle: null,
  sending: {
    label: 'Sending',
    variant: 'accent',
    icon: LoaderCircle,
  },
  running: {
    label: 'Megumi is working',
    variant: 'accent',
    icon: Sparkles,
  },
  'waiting-approval': {
    label: 'Waiting for approval',
    variant: 'approval',
    icon: Clock3,
  },
  error: {
    label: 'Needs attention',
    variant: 'danger',
    icon: TriangleAlert,
  },
} as const;

const COMPOSER_TEXTAREA_COMPACT_HEIGHT = 56;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 160;

export function Composer({
  status = 'idle',
  initialValue = '',
  onSubmit,
  onStop,
  onChooseContext,
  onAttachFiles,
  onShowApproval,
}: ComposerProps) {
  const modeId = useId();
  const modelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(initialValue);
  const [mode, setMode] = useState<ComposerMode>('chat');
  const [model, setModel] = useState<ComposerModel>('deepseek-v4-flash');
  const trimmedValue = value.trim();
  const inputLocked = status === 'waiting-approval';
  const sendLocked = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const canSend = trimmedValue.length > 0 && !sendLocked;
  const showStop = status === 'sending' || status === 'running';
  const canStop = showStop && Boolean(onStop);
  const placeholder = showStop ? 'Draft a follow-up while Megumi works...' : 'Ask Megumi anything...';
  const activeStatus = statusConfig[status];
  const StatusIcon = activeStatus?.icon;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = `${COMPOSER_TEXTAREA_COMPACT_HEIGHT}px`;

    const scrollHeight = textarea.scrollHeight;
    const nextHeight = value
      ? Math.max(COMPOSER_TEXTAREA_COMPACT_HEIGHT, Math.min(scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT))
      : COMPOSER_TEXTAREA_COMPACT_HEIGHT;

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  function submitDraft() {
    if (!canSend) return;

    onSubmit({
      message: trimmedValue,
      mode,
      model,
    });
    setValue('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraft();
  }

  function insertNewlineAtCursor(textarea: HTMLTextAreaElement) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    setValue(`${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') {
      return;
    }

    const isComposing = event.nativeEvent.isComposing || (event as unknown as { isComposing?: boolean }).isComposing;

    if (isComposing || event.shiftKey) {
      return;
    }

    if (event.altKey) {
      event.preventDefault();
      insertNewlineAtCursor(event.currentTarget);
      return;
    }

    event.preventDefault();
    submitDraft();
  }

  return (
    <form onSubmit={handleSubmit} className="pointer-events-auto mx-auto w-full min-w-[38rem] max-w-3xl px-6 pb-6">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)]">
        <div data-testid="composer-input-panel" className="border-b border-[var(--color-border)] px-3 py-2">
          <label htmlFor="megumi-composer" className="sr-only">
            Message Megumi
          </label>
          <textarea
            ref={textareaRef}
            id="megumi-composer"
            value={value}
            disabled={inputLocked}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={placeholder}
            rows={2}
            className="max-h-40 min-h-14 w-full resize-none border-0 bg-transparent text-sm leading-5 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)] disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>

        <div data-testid="composer-toolbar" className="flex flex-nowrap items-center justify-between gap-2 px-2 py-2">
          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton label="Attach files" variant="ghost" size="sm" className="shrink-0" onClick={onAttachFiles}>
              <Paperclip size={16} aria-hidden="true" />
            </IconButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={onChooseContext}
              aria-label="Choose context"
            >
              <AtSign size={15} aria-hidden="true" />
              Context
            </Button>

            {activeStatus && StatusIcon ? (
              <Badge variant={activeStatus.variant} className={cx(status === 'sending' ? 'animate-pulse' : undefined)}>
                <StatusIcon size={12} aria-hidden="true" />
                {activeStatus.label}
              </Badge>
            ) : null}
          </div>

          <div data-testid="composer-actions" className="flex min-w-0 shrink-0 items-center justify-end gap-2">
            <div className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-muted)]">
              <label htmlFor={modeId} className="sr-only">
                Composer mode
              </label>
              <Bot size={14} aria-hidden="true" />
              <select
                id={modeId}
                aria-label="Composer mode"
                value={mode}
                disabled={inputLocked}
                onChange={(event) => setMode(event.target.value as ComposerMode)}
                className="bg-transparent text-xs text-[var(--color-text)] outline-none disabled:cursor-not-allowed"
              >
                {COMPOSER_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex h-8 max-w-44 min-w-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-muted)]">
              <label htmlFor={modelId} className="sr-only">
                Model
              </label>
              <Brain size={14} aria-hidden="true" />
              <select
                id={modelId}
                aria-label="Model"
                value={model}
                disabled={inputLocked}
                onChange={(event) => setModel(event.target.value as ComposerModel)}
                className="max-w-36 truncate bg-transparent text-xs text-[var(--color-text)] outline-none disabled:cursor-not-allowed"
              >
                {COMPOSER_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {status === 'waiting-approval' ? (
              <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={onShowApproval}>
                Review approval
              </Button>
            ) : null}
            {showStop ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onStop}
                disabled={!canStop}
                aria-label="Stop current run"
                className="shrink-0"
              >
                <Square size={13} aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                aria-label="Send message"
                className="shrink-0"
                disabled={!canSend}
              >
                <SendHorizontal size={15} aria-hidden="true" />
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
